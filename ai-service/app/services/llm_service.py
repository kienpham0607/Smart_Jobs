import asyncio
import json
import logging
import math
import re
from datetime import date
from io import BytesIO

from pypdf import PdfReader

from app.prompts.job_advisor import advice_bundle_instructions
from app.prompts.profile_extract import extract_profile_instructions
from app.schemas.chat import AdvisorBundle, ExtractedProfile
from app.services.openai_client import AiProviderError, generate_json

logger = logging.getLogger("uvicorn.error")

COMPACT_SCHEMA = {
    "profile": "object",
    "answer": "string",
    "recommendations": "array",
}

EXTRACT_SCHEMA = {
    "name": "string|null",
    "phone": "string|null",
    "location": "string|null",
    "experience_years": "number|null",
    "desired_position": "string|null",
    "skills": "array",
    "bio": "string|null",
    "education": "array",
    "work_experience": "array",
    "certifications": "array",
    "languages": "array",
    "links": "object",
}


def extract_cv_text(pdf_bytes: bytes) -> str:
    raw = bytes(pdf_bytes)
    marker = raw.find(b"%PDF-", 0, 1024)
    if marker > 0:
        raw = raw[marker:]
    reader = PdfReader(BytesIO(raw))
    cv_text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    if not cv_text:
        raise ValueError("Could not extract text from CV PDF")
    return cv_text


def heuristic_profile(cv_text: str) -> dict:
    """Fast local profile so job retrieval can run before the single LLM call."""
    lowered = cv_text.casefold()
    skill_vocab = [
        "react",
        "next.js",
        "nextjs",
        "javascript",
        "typescript",
        "node.js",
        "nodejs",
        "mongodb",
        "express",
        "python",
        "java",
        "spring boot",
        "spring",
        "sql",
        "postgresql",
        "docker",
        "git",
        "html",
        "css",
        "tailwindcss",
        "tailwind",
        "vue",
        "angular",
        "flutter",
        "dart",
        "kotlin",
        "android",
        "swift",
        "ios",
        "aws",
        "linux",
        "ci/cd",
        "rest api",
        "fastapi",
        "power bi",
        "excel",
        "airflow",
        "etl",
        "pandas",
        "scikit-learn",
        "pytorch",
        "machine learning",
        "llm",
        "selenium",
        "postman",
        "testing",
        "figma",
        "ui design",
        "ux research",
    ]
    skill_map = {
        "nodejs": "node.js",
        "nextjs": "next.js",
        "tailwind": "tailwindcss",
        "spring": "spring boot",
    }
    skills = []
    compact_text = lowered.replace(".", "").replace(" ", "")
    for skill in skill_vocab:
        compact_skill = skill.replace(".", "").replace(" ", "")
        # Biên từ để "java" không khớp nhầm với "javascript".
        exact = re.search(rf"(?<![a-z0-9]){re.escape(skill)}(?![a-z0-9])", lowered)
        compact = compact_skill != skill and compact_skill in compact_text
        if exact or compact:
            mapped = skill_map.get(skill, skill)
            if mapped not in skills:
                skills.append(mapped)

    role_patterns = [
        r"front[\s-]?end developer",
        r"back[\s-]?end developer",
        r"full[\s-]?stack developer",
        r"software engineer",
        r"data engineer",
        r"data analyst",
        r"business intelligence analyst",
        r"bi analyst",
        r"data scientist",
        r"machine learning engineer",
        r"ai engineer",
        r"mobile developer",
        r"flutter developer",
        r"android developer",
        r"ios developer",
        r"qa engineer",
        r"automation qa",
        r"devops engineer",
        r"cloud engineer",
        r"cybersecurity analyst",
        r"ui/ux designer",
        r"lap trinh vien front[\s-]?end",
        r"l[aậ]p tr[iì]nh vi[eê]n front[\s-]?end",
        r"th[uư]c t[aậ]p sinh front[\s-]?end",
        r"front[\s-]?end",
        r"back[\s-]?end",
        r"full[\s-]?stack",
    ]
    roles = []
    for pattern in role_patterns:
        match = re.search(pattern, lowered, re.IGNORECASE)
        if match:
            raw = re.sub(r"\s+", " ", match.group(0)).strip()
            raw_cf = raw.casefold().replace("-", "")
            if "frontend" in raw_cf or "front end" in raw_cf:
                roles.append("frontend developer")
            elif "backend" in raw_cf or "back end" in raw_cf:
                roles.append("backend developer")
            elif "fullstack" in raw_cf or "full stack" in raw_cf:
                roles.append("full stack developer")
            else:
                roles.append(raw)
    # Deduplicate while preserving order.
    roles = list(dict.fromkeys(roles))
    if not roles and any(s in skills for s in ("react", "next.js", "vue", "angular", "javascript", "typescript")):
        roles.append("frontend developer")
    if not roles and any(s in skills for s in ("node.js", "java", "python", "spring boot", "fastapi")):
        roles.append("backend developer")

    years = _extract_stated_experience_years(lowered)

    location = None
    for place in (
        "hà nội",
        "ha noi",
        "hanoi",
        "hồ chí minh",
        "ho chi minh",
        "tphcm",
        "đà nẵng",
        "da nang",
        "danang",
        "thừa thiên huế",
        "huế",
        "remote",
    ):
        if place in lowered:
            location = place
            break

    return {
        "summary": " ".join(cv_text.split())[:280],
        "skills": skills[:20],
        "experience_roles": roles[:5],
        "target_roles": roles[:5],
        "desiredPosition": " ".join(roles[:5]),
        "experience_years": years,
        "location": location,
    }


_STATED_YEARS_PATTERNS = (
    re.compile(
        r"(?:kinh\s*nghi[ệe]m|experience|exp\.?)\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*\+?\s*(?:n[ăa]m|years?|yrs?)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"(\d+(?:[.,]\d+)?)\s*\+?\s*(?:n[ăa]m|years?|yrs?)\s+(?:kinh\s*nghi[ệe]m|experience|of\s+experience|exp\.?)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"(\d+(?:[.,]\d+)?)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:professional\s+)?experience\b",
        re.IGNORECASE,
    ),
)

_ACADEMIC_YEAR_NOISE = re.compile(
    r"(?:sinh\s*vi[êe]n|student|n[ăa]m\s*th[ứu]|year\s*(?:student|of)|ch[ươuo]ng\s*tr[ìi]nh|"
    r"c[ửu]?\s*nh[âa]n|đ[ạa]i\s*h[ọo]c|university|college|kho[áa]\s*h[ọo]c)",
    re.IGNORECASE,
)

_MONTH_MAP = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def _parse_float(raw: str) -> float | None:
    try:
        value = float(raw.replace(",", "."))
    except (TypeError, ValueError):
        return None
    if value < 0 or value > 60:
        return None
    return value


def _extract_stated_experience_years(text: str) -> float | None:
    """Only match explicit professional experience phrases — not academic 'N năm'."""
    for pattern in _STATED_YEARS_PATTERNS:
        for match in pattern.finditer(text):
            start = max(0, match.start() - 40)
            window = text[start : match.end() + 20]
            if _ACADEMIC_YEAR_NOISE.search(window):
                continue
            years = _parse_float(match.group(1))
            if years is not None:
                return years
    return None


def _parse_month_token(token: str) -> int | None:
    token = token.strip().casefold()
    if token.isdigit():
        month = int(token)
        return month if 1 <= month <= 12 else None
    for key, month in _MONTH_MAP.items():
        if month and (token == key or token.startswith(key)):
            return month
    vn = re.match(r"(?:th(?:[áa]ng)?\.?\s*)?(\d{1,2})$", token)
    if vn:
        month = int(vn.group(1))
        return month if 1 <= month <= 12 else None
    return None


def _parse_date_token(token: str) -> tuple[int, int] | None:
    """Return (year, month) — month defaults to 6 when only year is known."""
    raw = token.strip().casefold()
    raw = raw.replace("–", "-").replace("—", "-")
    if re.fullmatch(r"(?:nay|hi[ệe]n\s*t[ạa]i|present|current|now|today)", raw):
        today = date.today()
        return today.year, today.month

    # 2023 | 2023-06 | 06/2023 | 6/2023 | Jun 2023 | tháng 6/2023
    m = re.fullmatch(r"(\d{4})", raw)
    if m:
        return int(m.group(1)), 6

    m = re.fullmatch(r"(\d{4})[/-](\d{1,2})", raw)
    if m:
        month = int(m.group(2))
        return (int(m.group(1)), month) if 1 <= month <= 12 else None

    m = re.fullmatch(r"(\d{1,2})[/-](\d{4})", raw)
    if m:
        month = int(m.group(1))
        return (int(m.group(2)), month) if 1 <= month <= 12 else None

    m = re.fullmatch(r"(?:th(?:[áa]ng)?\.?\s*)?(\d{1,2})\s*[/-]\s*(\d{4})", raw)
    if m:
        month = int(m.group(1))
        return (int(m.group(2)), month) if 1 <= month <= 12 else None

    m = re.fullmatch(r"([a-zA-ZÀ-ỹ.]+)\s+(\d{4})", raw)
    if m:
        month = _parse_month_token(m.group(1))
        if month:
            return int(m.group(2)), month

    m = re.fullmatch(r"(\d{4})\s+([a-zA-ZÀ-ỹ.]+)", raw)
    if m:
        month = _parse_month_token(m.group(2))
        if month:
            return int(m.group(1)), month

    return None


def _period_years(period: str | None) -> float | None:
    if not period or not str(period).strip():
        return None
    text = re.sub(r"\s+", " ", str(period)).strip()
    # "6 tháng", "3 months"
    m = re.fullmatch(r"(\d+(?:[.,]\d+)?)\s*(?:th[áa]ng|months?|mos?)\b", text, re.IGNORECASE)
    if m:
        months = _parse_float(m.group(1))
        return None if months is None else round(months / 12, 2)

    m = re.fullmatch(r"(\d+(?:[.,]\d+)?)\s*(?:n[ăa]m|years?|yrs?)\b", text, re.IGNORECASE)
    if m:
        return _parse_float(m.group(1))

    parts = re.split(r"\s*(?:-|–|—|to|đ[ếe]n|t[ớo]i|->|→)\s*", text, maxsplit=1)
    if len(parts) != 2:
        return None
    start = _parse_date_token(parts[0])
    end = _parse_date_token(parts[1])
    if not start or not end:
        return None
    months = (end[0] - start[0]) * 12 + (end[1] - start[1])
    if months < 0 or months > 60 * 12:
        return None
    return round(max(months, 1) / 12, 2)


def _is_internship_like(text: str | None) -> bool:
    if not text:
        return False
    lowered = text.casefold()
    markers = (
        "thực tập",
        "thuc tap",
        "intern",
        "internship",
        "fresher",
        "sinh viên",
        "sinh vien",
        "trainee",
        "student",
    )
    return any(marker in lowered for marker in markers)


def _years_from_work_experience(work_experience: list | None) -> float | None:
    if not work_experience:
        return None
    total = 0.0
    counted = 0
    for item in work_experience:
        if not isinstance(item, dict):
            continue
        years = _period_years(item.get("period"))
        if years is None:
            continue
        total += years
        counted += 1
    if counted == 0:
        return None
    return round(min(total, 60.0), 2)


def _normalize_experience_years(merged: dict) -> dict:
    """Prefer work-history math; avoid academic false positives and intern inflation."""
    work = merged.get("work_experience") or []
    computed = _years_from_work_experience(work)
    stated = merged.get("experience_years")
    if isinstance(stated, (int, float)):
        stated = float(stated)
        if stated < 0 or stated > 60:
            stated = None
    else:
        stated = None

    position_blob = " ".join(
        filter(
            None,
            [
                merged.get("desired_position"),
                merged.get("bio"),
                *(str(item.get("title") or "") for item in work if isinstance(item, dict)),
            ],
        )
    )
    junior = _is_internship_like(position_blob)
    only_internships = bool(work) and all(
        _is_internship_like(
            " ".join(
                filter(
                    None,
                    [
                        item.get("title") if isinstance(item, dict) else None,
                        item.get("description") if isinstance(item, dict) else None,
                    ],
                )
            )
        )
        for item in work
    )
    no_work = not work

    if computed is not None:
        years = computed
    elif stated is not None:
        years = stated
    elif junior or no_work:
        years = 0.0
    else:
        years = None

    # Intern/student with no solid employment: don't keep inflated LLM guesses (e.g. 2).
    if years is not None and junior and (no_work or only_internships) and computed is None and years >= 1:
        years = 0.0

    if years is not None:
        years = max(0.0, min(float(years), 60.0))
        # Half-year steps for the profile form.
        # Làm tròn nửa lên (round() của Python làm tròn 0.5 về 0).
        years = math.floor(years * 2 + 0.5) / 2
        if years == int(years):
            years = float(int(years))

    merged["experience_years"] = years
    return merged


def _merge_extract(heuristic: dict, extracted: dict) -> dict:
    """Prefer LLM values; fall back to local heuristic for blanks."""
    merged = dict(extracted)
    if not merged.get("skills"):
        merged["skills"] = heuristic.get("skills") or []
    if merged.get("desired_position") in (None, ""):
        roles = heuristic.get("target_roles") or heuristic.get("experience_roles") or []
        merged["desired_position"] = roles[0] if roles else heuristic.get("desiredPosition")
    if merged.get("experience_years") is None:
        merged["experience_years"] = heuristic.get("experience_years")
    if merged.get("location") in (None, ""):
        merged["location"] = heuristic.get("location")
    if merged.get("bio") in (None, ""):
        merged["bio"] = heuristic.get("summary")
    return _normalize_experience_years(merged)


_DISPLAY_LOCATIONS = {
    "hà nội": "Hà Nội",
    "ha noi": "Hà Nội",
    "hanoi": "Hà Nội",
    "hồ chí minh": "TP. Hồ Chí Minh",
    "ho chi minh": "TP. Hồ Chí Minh",
    "tphcm": "TP. Hồ Chí Minh",
    "đà nẵng": "Đà Nẵng",
    "da nang": "Đà Nẵng",
    "danang": "Đà Nẵng",
    "thừa thiên huế": "Huế",
    "huế": "Huế",
    "remote": "Remote",
}


def _display_location(raw: str | None) -> str | None:
    if not raw:
        return None
    return _DISPLAY_LOCATIONS.get(raw.strip().casefold(), raw.strip().title())


_SECTION_HEADINGS = {
    "education": (
        "education",
        "học vấn",
        "hoc van",
        "trình độ học vấn",
    ),
    "work": (
        "work experience",
        "experience",
        "professional experience",
        "employment history",
        "kinh nghiệm làm việc",
        "kinh nghiệm",
        "kinh nghiem lam viec",
    ),
    "summary": (
        "summary",
        "profile",
        "about me",
        "objective",
        "career objective",
        "giới thiệu",
        "giới thiệu bản thân",
        "mục tiêu nghề nghiệp",
    ),
    "other": (
        "projects",
        "dự án",
        "skills",
        "kỹ năng",
        "certifications",
        "chứng chỉ",
        "languages",
        "ngoại ngữ",
        "activities",
        "hoạt động",
        "awards",
        "giải thưởng",
        "references",
        "interests",
        "sở thích",
    ),
}

_DATE_TOKEN = (
    r"(?:[A-Za-zÀ-ỹ]{3,9}\.?\s+\d{4}|\d{1,2}[/-]\d{4}|\d{4}[/-]\d{1,2}|\d{4}"
    r"|present|current|now|nay|hiện\s*tại)"
)
_DATE_RANGE_AT_END = re.compile(
    rf"\s*({_DATE_TOKEN})\s*(?:-|–|—|to|đến)\s*({_DATE_TOKEN})\s*$",
    re.IGNORECASE,
)


def _split_sections(lines: list[str]) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current = "header"
    for line in lines:
        key = line.casefold().strip(" :")
        matched = next(
            (name for name, heads in _SECTION_HEADINGS.items() if key in heads),
            None,
        )
        if matched:
            current = matched if matched != "other" else f"other:{key}"
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)
    return sections


def _split_entries(lines: list[str]) -> list[dict]:
    """Group a section into entries that start with a line ending in a date range."""
    entries: list[dict] = []
    for line in lines:
        match = _DATE_RANGE_AT_END.search(line)
        if match:
            entries.append(
                {
                    "head": line[: match.start()].strip(" |,-–—"),
                    "period": f"{match.group(1)} - {match.group(2)}",
                    "body": [],
                }
            )
        elif entries:
            entries[-1]["body"].append(line)
    return entries


def _parse_work_entries(lines: list[str]) -> list[dict]:
    items = []
    for entry in _split_entries(lines):
        body = entry["body"]
        title = ""
        if body and not body[0].startswith(("•", "-", "*")):
            title = re.split(r"\s+[—–|]\s+", body[0], maxsplit=1)[0].strip()
            body = body[1:]
        description = " ".join(line.lstrip("•-* ").strip() for line in body)
        items.append(
            {
                "title": title[:120],
                "company": entry["head"][:120],
                "period": entry["period"],
                "description": description[:400],
            }
        )
    return items


def _parse_education_entries(lines: list[str]) -> list[dict]:
    items = []
    for entry in _split_entries(lines):
        degree, field = "", ""
        if entry["body"]:
            first = entry["body"][0].split("|", 1)[0].strip()
            parts = re.split(r"\s+(?:in|of|ngành|chuyên ngành)\s+", first, maxsplit=1, flags=re.I)
            degree = parts[0].strip()
            field = parts[1].strip() if len(parts) > 1 else ""
        items.append(
            {
                "school": entry["head"][:120],
                "degree": degree[:120],
                "field": field[:120],
                "period": entry["period"],
            }
        )
    return items


def _find_link(cv_text: str, domain_pattern: str) -> str | None:
    match = re.search(
        rf"(?:https?://)?(?:www\.)?{domain_pattern}/[A-Za-z0-9_.\-/]+",
        cv_text,
        re.IGNORECASE,
    )
    if not match:
        return None
    url = match.group(0).rstrip("/.")
    return url if url.lower().startswith("http") else f"https://{url}"


def _looks_like_headline(line: str) -> bool:
    if len(line) > 90 or "@" in line or re.search(r"\d{3}", line):
        return False
    return bool(re.search(r"[A-Za-zÀ-ỹ]{3}", line))


def _heuristic_extract_profile(cv_text: str, heuristic: dict) -> dict:
    lines = [line.strip() for line in cv_text.splitlines() if line.strip()]
    sections = _split_sections(lines)
    header = sections.get("header") or lines[:3]

    name = header[0][:80] if header else None
    headline = header[1] if len(header) > 1 and _looks_like_headline(header[1]) else None

    phone_match = re.search(r"(?:\+?84|0)(?:[\s.\-()]?\d){8,10}", cv_text)
    phone = re.sub(r"[\s().\-]", "", phone_match.group(0)) if phone_match else None

    work_experience = _parse_work_entries(sections.get("work", []))
    education = _parse_education_entries(sections.get("education", []))

    summary_lines = sections.get("summary") or []
    if summary_lines:
        bio = " ".join(summary_lines)[:500]
    elif headline:
        bio = headline
    else:
        bio = None

    roles = heuristic.get("target_roles") or heuristic.get("experience_roles") or []
    desired_position = headline or (roles[0].title() if roles else None)

    extracted = {
        "name": name,
        "phone": phone,
        "location": _display_location(heuristic.get("location")),
        "experience_years": heuristic.get("experience_years"),
        "desired_position": desired_position,
        "skills": heuristic.get("skills") or [],
        "bio": bio,
        "education": education,
        "work_experience": work_experience,
        "certifications": [],
        "languages": [],
        "links": {
            "linkedin": _find_link(cv_text, r"linkedin\.com/in"),
            "github": _find_link(cv_text, r"github\.com"),
            "portfolio": None,
        },
    }
    merged = _merge_extract(heuristic, extracted)
    merged["source"] = "heuristic"
    return merged


def _heuristic_advice_bundle(
    cv_text: str,
    question: str,
    retrieved_jobs: list[dict],
) -> dict:
    draft = heuristic_profile(f"{cv_text}\n{question}")
    roles = draft.get("target_roles") or draft.get("experience_roles") or ["Lập trình viên"]
    skills = draft.get("skills") or []
    years = draft.get("experience_years")
    if years is None:
        years = 0.0
    loc_display = _display_location(draft.get("location"))

    role_label = ", ".join(r.title() for r in roles[:2])
    skill_label = ", ".join(skills[:5]) if skills else "các kỹ năng chuyên môn trong CV"

    high_jobs = [item for item in retrieved_jobs if item.get("priority") == "high"]
    sentences = [
        f"CV của bạn phù hợp nhất với vị trí {role_label} nhờ nền tảng {skill_label}."
    ]
    if years == 0 or _is_internship_like(cv_text):
        loc_clause = f" tại {loc_display}" if loc_display else ""
        sentences.append(
            f"Ưu tiên ứng tuyển các vị trí Thực tập / Fresher{loc_clause}; "
            "các tin yêu cầu từ 1–2 năm kinh nghiệm hoặc khác khu vực sẽ cần cân nhắc thêm."
        )
    else:
        loc_clause = f" tại {loc_display}" if loc_display else ""
        sentences.append(
            f"Với khoảng {years:g} năm kinh nghiệm, bạn có lợi thế tốt ở các vị trí phù hợp{loc_clause}."
        )
    if high_jobs:
        top_titles = ", ".join(item["job"].get("title", "") for item in high_jobs[:2] if item.get("job"))
        sentences.append(
            f"Hệ thống tìm thấy {len(high_jobs)} công việc khớp trực tiếp ở nhóm Ưu tiên cao (nổi bật: {top_titles})."
        )

    known_skills = {s.casefold() for s in skills}
    recommendations = []
    for item in retrieved_jobs:
        job = item.get("job") or {}
        job_id = str(job.get("_id") or "")
        if not job_id:
            continue
        matched = item.get("matched_skills") or []
        score = item.get("score", 0)
        matched_set = known_skills | {s.casefold() for s in matched}
        gaps = [
            req for req in (job.get("requiredSkills") or []) if req.casefold() not in matched_set
        ]
        matched_text = ", ".join(matched) if matched else "nội dung liên quan"
        if item.get("priority") == "high":
            reason = (
                f"Khớp trực tiếp vị trí và kỹ năng ({matched_text}) — đạt {score}/100 điểm theo hồ sơ CV."
            )
        else:
            reason = (
                f"Công việc liên quan có điểm tương đồng ({matched_text}) — đạt {score}/100 điểm."
            )
        recommendations.append(
            {
                "job_id": job_id,
                "reason": reason,
                "skill_gaps": gaps,
            }
        )

    return AdvisorBundle(
        profile={
            "summary": draft.get("summary") or "Hồ sơ ứng viên từ CV đã tải lên.",
            "skills": skills,
            "experience_roles": draft.get("experience_roles") or roles,
            "target_roles": roles,
            "experience_years": years,
            "location": loc_display,
        },
        answer=" ".join(sentences),
        recommendations=recommendations,
    ).model_dump()


async def extract_profile_from_cv(cv_text: str) -> dict:
    heuristic = heuristic_profile(cv_text)
    try:
        response_text = await asyncio.to_thread(
            generate_json,
            extract_profile_instructions(),
            f"CV text:\n{cv_text[:8000]}",
            1100,
            EXTRACT_SCHEMA,
        )
        extracted = ExtractedProfile.model_validate_json(response_text).model_dump()
        merged = _merge_extract(heuristic, extracted)
        merged["source"] = "ai"
        return merged
    except (AiProviderError, ValueError, KeyError) as error:
        logger.warning("extract-profile: AI call failed, using heuristic fallback: %s", error)
        return _heuristic_extract_profile(cv_text, heuristic)


async def analyze_and_advise(
    cv_text: str,
    question: str,
    retrieved_jobs: list[dict],
    history: list[dict] | None = None,
) -> dict:
    # Keep payload small — main latency driver on the remote model.
    context = {
        "cv_text": cv_text[:6000],
        "question": question[:400],
        "history": [
            {"role": item.get("role", "user"), "content": str(item.get("content", ""))[:500]}
            for item in (history or [])[-10:]
        ],
        "available_jobs": [
            {
                "job_id": item["job"].get("_id"),
                "title": item["job"].get("title"),
                "company": item["job"].get("companyName"),
                "location": item["job"].get("location"),
                "required_skills": item["job"].get("requiredSkills", [])[:8],
                "experience_min": item["job"].get("experienceMin"),
                "priority": item["priority"],
                "matched_cv_skills": item.get("matched_skills", [])[:6],
            }
            for item in retrieved_jobs[:8]
        ],
    }
    try:
        response_text = await asyncio.to_thread(
            generate_json,
            advice_bundle_instructions(),
            f"Dữ liệu:\n{json.dumps(context, ensure_ascii=False)}",
            900,
            COMPACT_SCHEMA,
        )
        return AdvisorBundle.model_validate_json(response_text).model_dump()
    except (AiProviderError, ValueError, KeyError):
        return _heuristic_advice_bundle(cv_text, question, retrieved_jobs)
