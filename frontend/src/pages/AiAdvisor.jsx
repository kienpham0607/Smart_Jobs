import { useEffect, useRef, useState } from 'react';
import { AlertCircle, BrainCircuit, FileText, RotateCcw, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import JobCard from '../components/JobCard.jsx';
import { PageHeading } from '../components/UI.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api, errorMessage } from '../lib/api.js';

const DEFAULT_MESSAGE = 'Phân tích CV và gợi ý các công việc phù hợp với tôi.';

const QUICK_PROMPTS = [
  'Gợi ý việc phù hợp nhất với CV của tôi',
  'Tôi nên bổ sung kỹ năng gì để ứng tuyển tốt hơn?',
  'Tìm việc thực tập / fresher phù hợp với tôi',
  'Tìm việc tại TP. Hồ Chí Minh',
];

const LOADING_STEPS = [
  'Đang đọc CV của bạn…',
  'Đang so khớp kỹ năng với các tin tuyển dụng…',
  'Đang soạn lời tư vấn…',
];

function scrollIntoViewSoon(ref) {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => {
    window.setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      ref.current?.focus({ preventScroll: true });
    }, 80);
  });
}

export default function AiAdvisor() {
  const toast = useToast();
  const resultsRef = useRef(null);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [requestError, setRequestError] = useState('');
  const [cvMeta, setCvMeta] = useState(null);
  const [cvPreview, setCvPreview] = useState(null);
  const [cvLoading, setCvLoading] = useState(true);
  const [cvError, setCvError] = useState('');
  const [cvOpen, setCvOpen] = useState(true);
  const hasCv = Boolean(cvMeta);
  const highPriority = result?.recommendations.filter((item) => item.priority === 'high') || [];
  const relatedJobs = result?.recommendations.filter((item) => item.priority === 'related') || [];

  useEffect(() => {
    let cancelled = false;
    let objectUrl;

    async function loadCv() {
      try {
        const metadata = await api.get('/resumes/me');
        if (cancelled || !metadata.data.data) return;
        setCvMeta(metadata.data.data);
        const file = await api.get('/resumes/me/file', { responseType: 'blob', timeout: 30000 });
        objectUrl = URL.createObjectURL(file.data);
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else setCvPreview(objectUrl);
      } catch (error) {
        if (!cancelled) setCvError(errorMessage(error));
      } finally {
        if (!cancelled) setCvLoading(false);
      }
    }

    loadCv();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  // Rotate the loading hint so a 20–40s wait doesn't look frozen.
  useEffect(() => {
    if (!busy) return undefined;
    setLoadingStep(0);
    const timer = window.setInterval(
      () => setLoadingStep((step) => Math.min(step + 1, LOADING_STEPS.length - 1)),
      7000,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  const renderJobs = (items) =>
    items.map((match) => (
      <JobCard
        key={match.job._id}
        job={{
          ...match.job,
          reasons: [
            match.reason,
            ...(match.skill_gaps.length ? [`Nên bổ sung: ${match.skill_gaps.join(', ')}`] : []),
          ],
        }}
      />
    ));

  async function analyze() {
    if (busy || !hasCv) return;
    setBusy(true);
    setRequestError('');
    scrollIntoViewSoon(resultsRef);
    try {
      const response = await api.post(
        '/ai/chat',
        { message: message.trim() || DEFAULT_MESSAGE },
        { timeout: 180000 },
      );
      setResult(response.data.data);
      scrollIntoViewSoon(resultsRef);
    } catch (error) {
      const text = errorMessage(error);
      setRequestError(text);
      toast(text, 'error');
    } finally {
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    analyze();
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      analyze();
    }
  }

  const showResultsArea = busy || requestError || result;

  return (
    <div className="page-shell ai-advisor-page">
      <PageHeading
        band
        eyebrow="CỐ VẤN NGHỀ NGHIỆP AI"
        title="Tìm việc từ chính CV của bạn."
        description="AI phân tích kỹ năng và kinh nghiệm trong CV, sau đó tìm các tin tuyển dụng phù hợp."
      />

      <div className="container page-body">
        <section className="panel ai-cv-preview" aria-label="CV dùng để phân tích">
          <div className="ai-cv-preview-heading">
            <div className="ai-cv-file">
              <span className="ai-cv-icon" aria-hidden="true">
                <FileText size={20} />
              </span>
              <div>
                <h2>CV dùng để phân tích</h2>
                <p>
                  {cvLoading
                    ? 'Đang kiểm tra CV…'
                    : hasCv
                      ? cvMeta.originalName || 'CV của bạn'
                      : 'Chưa có CV'}
                </p>
              </div>
            </div>
            <div className="ai-cv-preview-actions">
              {hasCv && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  aria-expanded={cvOpen}
                  aria-controls="ai-cv-frame"
                  onClick={() => setCvOpen((open) => !open)}
                >
                  {cvOpen ? 'Ẩn CV' : 'Xem CV'}
                </button>
              )}
              <Link
                className={`btn btn-small ${hasCv ? 'btn-secondary' : 'btn-primary'}`}
                to="/profile"
              >
                {hasCv ? 'Đổi CV' : (
                  <>
                    <Upload size={15} /> Tải CV lên
                  </>
                )}
              </Link>
            </div>
          </div>
          {!cvLoading && !hasCv && (
            <p className="ai-cv-missing" role="status">
              {cvError ||
                'Bạn cần tải CV PDF lên trang Hồ sơ trước khi dùng tư vấn AI.'}
            </p>
          )}
          {hasCv && cvOpen && (
            <div id="ai-cv-frame" className="ai-cv-preview-body">
              {cvPreview ? (
                <iframe className="ai-cv-preview-frame" src={cvPreview} title="Bản xem trước CV PDF" />
              ) : (
                <div className="state-box">
                  <p>{cvError || 'Đang tải bản xem trước CV…'}</p>
                </div>
              )}
            </div>
          )}
        </section>

        <form className="panel ai-chat-form" onSubmit={submit}>
          <label className="field">
            <span>Bạn muốn được tư vấn điều gì? (không bắt buộc)</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              maxLength={1200}
              disabled={busy}
              placeholder="Ví dụ: Tôi muốn tìm việc Data Engineer tại Hà Nội. Để trống để AI tự gợi ý việc phù hợp với CV."
            />
          </label>
          <div className="ai-quick-prompts" aria-label="Gợi ý câu hỏi">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="ai-quick-prompt"
                disabled={busy}
                aria-pressed={message === prompt}
                onClick={() => setMessage(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
          <div className="ai-chat-actions">
            <small>
              {hasCv
                ? 'Mất khoảng 15–40 giây. Nhấn Ctrl + Enter để gửi nhanh.'
                : 'Tải CV lên để bắt đầu phân tích.'}
            </small>
            <button className="btn btn-primary" disabled={busy || !hasCv}>
              <BrainCircuit size={17} /> {busy ? 'Đang phân tích…' : 'Phân tích và gợi ý'}
            </button>
          </div>
        </form>

        <div
          className="ai-results"
          id="ai-job-suggestions"
          ref={resultsRef}
          tabIndex={-1}
          aria-live="polite"
          aria-busy={busy}
          hidden={!showResultsArea}
        >
          {busy && (
            <section className="panel ai-loading-panel">
              <span className="ai-spinner" aria-hidden="true" />
              <div>
                <h2>{LOADING_STEPS[loadingStep]}</h2>
                <p>Bạn có thể ở lại trang này, kết quả sẽ hiện ngay bên dưới.</p>
              </div>
            </section>
          )}

          {!busy && requestError && (
            <section className="panel ai-error-panel" role="alert">
              <AlertCircle size={22} aria-hidden="true" />
              <div>
                <h2>Chưa phân tích được CV</h2>
                <p>{requestError}</p>
              </div>
              <button type="button" className="btn btn-secondary btn-small" onClick={analyze}>
                <RotateCcw size={15} /> Thử lại
              </button>
            </section>
          )}

          {!busy && result && (
            <>
              {result.answer && (
                <section className="panel ai-answer-panel">
                  <h2>Lời tư vấn từ AI</h2>
                  <p>{result.answer}</p>
                </section>
              )}

              {result.recommendations.length === 0 ? (
                <div className="state-box">
                  <p>
                    Chưa có tin tuyển dụng phù hợp với CV.{' '}
                    <Link className="text-link" to="/jobs">
                      Xem tất cả việc làm
                    </Link>
                  </p>
                </div>
              ) : (
                <>
                  <section className="ai-priority-group ai-priority-high">
                    <div className="results-heading">
                      <h2>Khớp trực tiếp ({highPriority.length})</h2>
                      <span>Đúng vị trí và kỹ năng trong CV</span>
                    </div>
                    {highPriority.length ? (
                      <div className="job-grid">{renderJobs(highPriority)}</div>
                    ) : (
                      <div className="state-box">
                        <p>Chưa có tin khớp cả vị trí và kỹ năng. Xem các việc liên quan bên dưới.</p>
                      </div>
                    )}
                  </section>
                  {relatedJobs.length > 0 && (
                    <section className="ai-priority-group ai-priority-low">
                      <div className="results-heading">
                        <h2>Có thể phù hợp ({relatedJobs.length})</h2>
                        <span>Có kỹ năng hoặc nội dung tương đồng</span>
                      </div>
                      <div className="job-grid">{renderJobs(relatedJobs)}</div>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
