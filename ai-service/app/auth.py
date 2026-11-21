import hmac
import re

import jwt
from fastapi import HTTPException, Request

from app.settings import settings


def candidate_id(request: Request) -> str:
    authorization = request.headers.get("authorization", "")
    token = authorization.removeprefix("Bearer ").strip()
    if not token or not settings.jwt_secret:
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập.")
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            issuer="smartjob-users",
            audience="smartjob",
            options={"require": ["exp", "sub", "role"]},
        )
    except jwt.PyJWTError as error:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ.") from error
    if payload.get("role") != "CANDIDATE":
        raise HTTPException(status_code=403, detail="Tính năng này dành cho ứng viên.")
    user_id = payload.get("sub", "")
    # Đồng bộ với packages/shared: ID là UUID Postgres, không còn ObjectId Mongo.
    if not re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
        user_id,
        flags=re.IGNORECASE,
    ):
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ.")
    return user_id


def require_service(request: Request) -> None:
    token = request.headers.get("x-service-token", "")
    expected = settings.internal_service_token
    if not expected or len(token) != len(expected) or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="Khóa dịch vụ không hợp lệ.")
