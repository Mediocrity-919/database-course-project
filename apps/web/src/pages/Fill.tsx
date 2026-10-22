import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { api, ApiError, json, useAuth, useData } from "../api.js";
import { Brand, Button, dateText, ErrorBox, Loading, Status } from "../ui.js";
import { Runner } from "../components/Runner.js";
import { createUuid } from "../uuid.js";
export function SurveyEntry() {
  const { publicId } = useParams(),
    { data, error, loading } = useData(`/public/surveys/${publicId}`),
    { user, loading: authLoading } = useAuth(),
    navigate = useNavigate();
  const [mine, setMine] = useState<{
      key: string;
      items: any[];
      error: string;
    } | null>(null),
    [anonymous, setAnonymous] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const clientId = useRef(createUuid());
  const mineKey = user ? `${user.id}:${publicId}` : "";
  useEffect(() => {
    let live = true;
    if (user) {
      api(`/public/surveys/${publicId}/my-attempts`)
        .then((x) => {
          if (live) setMine({ key: mineKey, items: x.items, error: "" });
        })
        .catch((e) => {
          if (live) setMine({ key: mineKey, items: [], error: e.message });
        });
    }
    return () => {
      live = false;
    };
  }, [mineKey]);
  useEffect(() => {
    if (data) setAnonymous(data.settings.allowAnonymous);
  }, [data]);
  if (loading || authLoading || (user && mine?.key !== mineKey))
    return <Loading />;
  if (error || !data)
    return (
      <div className="public-page">
        <Brand />
        <div className="panel">
          <ErrorBox message={error || "问卷不存在"} />
          <Link to="/">返回首页</Link>
        </div>
      </div>
    );
  const items = user && mine?.key === mineKey ? mine.items : [],
    submitted = items.find((r) => r.status === "submitted"),
    draft = items.find((r) => r.status === "in_progress"),
    singleSubmitted = submitted && !data.settings.allowMultipleSubmissions;
  return (
    <div className="public-page">
      <header className="public-header">
        <Brand />
        {user ? (
          <span className="muted">{user.username}</span>
        ) : (
          <Link to={`/login?returnTo=/survey/${publicId}`}>登录 / 注册</Link>
        )}
      </header>
      <div className="entry-card panel">
        <div className="entry-icon">
          <FileText size={30} />
        </div>
        <div className="eyebrow">A QUESTION WORTH ASKING</div>
        <h1>{data.title}</h1>
        <p className="entry-description">
          {data.description || "感谢你抽出时间，分享真实的想法。"}
        </p>
        <div className="entry-facts">
          <span>
            <FileText size={16} />
            {data.questionCount} 道题目
          </span>
          <span>
            <Clock size={16} />
            {data.deadlineAt
              ? `截止 ${dateText(data.deadlineAt)}`
              : "未设置截止时间"}
          </span>
          <Status status={data.effectiveStatus} />
        </div>
        <div className="privacy-note">
          <ShieldCheck size={20} />
          <div>
            <strong>
              {data.settings.allowAnonymous
                ? "可以匿名分享你的想法"
                : "此问卷采用实名填写"}
            </strong>
            <p>
              {data.settings.allowAnonymous
                ? "填写仍需登录。选择匿名后，创建者无法查看你的账号身份。"
                : "创建者可以查看你的账号身份，请按实际情况填写。"}
            </p>
            <p>
              {data.settings.allowMultipleSubmissions
                ? "允许多次填写，每次生成一份新答卷。"
                : data.settings.allowEditAfterSubmission
                  ? "每人保留一份答卷，开放期间可修改原答案。"
                  : "每人只能提交一次，提交后不能修改。"}
            </p>
          </div>
        </div>
        <ErrorBox message={message || (user && mine?.error) || ""} />
        {singleSubmitted ? (
          <div className="entry-bottom">
            <span>
              <CheckCircle2 size={18} />
              你已完成这份问卷
            </span>
            <Link
              className="btn"
              to={`/survey/${publicId}/complete/${submitted.id}`}
            >
              查看或修改我的答案
              <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <>
            {data.settings.allowAnonymous && (
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={draft ? draft.isAnonymous : anonymous}
                  disabled={!!draft || busy}
                  onChange={(e) => setAnonymous(e.target.checked)}
                />
                以匿名方式提交
              </label>
            )}
            {draft && (
              <p className="muted">
                继续填写将沿用这份草稿的{draft.isAnonymous ? "匿名" : "实名"}
                设置。
              </p>
            )}
            <div className="entry-bottom">
              <span>
                {draft ? "有一份尚未完成的填写记录" : "准备好开始了吗？"}
              </span>
              <Button
                disabled={
                  busy ||
                  !!(user && mine?.error) ||
                  data.effectiveStatus !== "published"
                }
                onClick={async () => {
                  if (!user) {
                    navigate(
                      `/login?returnTo=${encodeURIComponent(`/survey/${publicId}`)}`,
                    );
                    return;
                  }
                  if (draft) {
                    navigate(`/survey/${publicId}/attempt/${draft.id}`);
                    return;
                  }
                  setBusy(true);
                  try {
                    const x = await api(
                      `/public/surveys/${publicId}/attempts`,
                      {
                        method: "POST",
                        body: json({
                          clientAttemptId: clientId.current,
                          isAnonymous: anonymous,
                        }),
                      },
                    );
                    navigate(`/survey/${publicId}/attempt/${x.attempt.id}`);
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy
                  ? "正在准备…"
                  : data.effectiveStatus !== "published"
                    ? "问卷已停止收集"
                    : draft
                      ? "继续填写"
                      : data.settings.allowMultipleSubmissions && submitted
                        ? "再填写一次"
                        : "开始填写"}
                <ArrowRight size={16} />
              </Button>
            </div>
          </>
        )}
      </div>
      <p className="public-footnote">
        由问笺提供支持 · 每一个回答，都值得被认真对待
      </p>
    </div>
  );
}
export function FillSurvey() {
  const { publicId, attemptId } = useParams(),
    { user, loading: authLoading } = useAuth(),
    { data, error, loading } = useData(`/attempts/${attemptId}`),
    navigate = useNavigate();
  const revision = useRef(1),
    submissionId = useRef(createUuid());
  useEffect(() => {
    if (data) revision.current = data.attempt.revision;
  }, [data]);
  if (authLoading) return <Loading />;
  if (!user)
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(`/survey/${publicId}/attempt/${attemptId}`)}`}
        replace
      />
    );
  if (loading) return <Loading />;
  if (error || !data)
    return (
      <div className="public-page">
        <Brand />
        <ErrorBox message={error || "答卷不存在"} />
      </div>
    );
  if (data.survey.publicId !== publicId)
    return (
      <Navigate
        to={`/survey/${data.survey.publicId}/attempt/${attemptId}`}
        replace
      />
    );
  if (data.attempt.status === "submitted" && !data.attempt.isEditing)
    return (
      <Navigate to={`/survey/${publicId}/complete/${attemptId}`} replace />
    );
  return (
    <div className="public-page">
      <header className="public-header">
        <Brand />
        <span className="muted">
          {data.attempt.isAnonymous ? "匿名作答" : "实名作答"} · {user.username}
        </span>
      </header>
      <div className="fill-heading">
        <Link to={`/survey/${publicId}`}>← 返回问卷简介</Link>
        <h1>{data.definition.title}</h1>
        {data.attempt.isEditing && (
          <p className="edit-notice">
            正在修改原答卷。确认提交前，统计继续使用原答案；修改成功后不会新增答卷。
          </p>
        )}
      </div>
      <div className="panel">
        <Runner
          key={attemptId}
          definition={data.definition}
          initialAnswers={data.attempt.answers}
          onSave={async (answers) => {
            const sentRevision = revision.current;
            const payload = answers.map(({ questionId, value }) => ({
              questionId,
              value,
            }));
            try {
              const r = await api(`/attempts/${attemptId}/answers`, {
                method: "PUT",
                body: json({ revision: sentRevision, answers: payload }),
              });
              revision.current = r.revision;
            } catch (error) {
              if (
                error instanceof ApiError &&
                error.status < 500 &&
                error.code !== "REVISION_CONFLICT"
              )
                throw error;
              // Recover a lost save acknowledgement only if this exact snapshot
              // is present at the immediately following revision.
              const latest = await api(`/attempts/${attemptId}`).catch(
                () => null,
              );
              const a = latest?.attempt;
              if (
                a &&
                a.revision === sentRevision + 1 &&
                (a.status === "in_progress" || a.isEditing) &&
                json(
                  a.answers.map(
                    ({
                      questionId,
                      value,
                    }: {
                      questionId: string;
                      value: unknown;
                    }) => ({ questionId, value }),
                  ),
                ) === json(payload)
              ) {
                revision.current = a.revision;
                return;
              }
              throw error;
            }
          }}
          onSubmit={async (answers) => {
            await api(`/attempts/${attemptId}/submit`, {
              method: "POST",
              body: json({
                revision: revision.current,
                submissionId: submissionId.current,
                answers: answers.map(({ questionId, value }) => ({
                  questionId,
                  value,
                })),
              }),
            });
            navigate(`/survey/${publicId}/complete/${attemptId}`, {
              replace: true,
            });
          }}
        />
      </div>
      <p className="public-footnote">
        按题目规则自动跳转 · 离开当前题时保存答案
      </p>
    </div>
  );
}
export function Complete() {
  const { publicId, attemptId } = useParams(),
    { user, loading: authLoading } = useAuth(),
    { data, error, loading } = useData(`/attempts/${attemptId}`),
    navigate = useNavigate();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  if (authLoading) return <Loading />;
  if (!user)
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(`/survey/${publicId}/complete/${attemptId}`)}`}
        replace
      />
    );
  if (loading) return <Loading />;
  if (error || !data)
    return (
      <div className="public-page">
        <Brand />
        <ErrorBox message={error || "答卷不存在"} />
      </div>
    );
  if (data.survey.publicId !== publicId)
    return (
      <Navigate
        to={`/survey/${data.survey.publicId}/complete/${attemptId}`}
        replace
      />
    );
  if (data.attempt.status !== "submitted")
    return <Navigate to={`/survey/${publicId}/attempt/${attemptId}`} replace />;
  const open = data.survey.effectiveStatus === "published",
    settings = data.definition.settings;
  return (
    <div className="public-page">
      <Brand />
      <div className="panel complete-card">
        <div className="success-mark">
          <Check size={35} />
        </div>
        <div className="eyebrow">THANK YOU FOR YOUR VOICE</div>
        <h1>回答已收到，谢谢你。</h1>
        <p>你的每一个想法，都是这次发现的一部分。</p>
        <div className="receipt">
          <span>{data.definition.title}</span>
          <small>最近提交：{dateText(data.attempt.lastSubmittedAt)}</small>
          <small>凭证：{attemptId}</small>
          {data.attempt.editCount > 0 && (
            <small>已修改 {data.attempt.editCount} 次，保留同一份答卷</small>
          )}
        </div>
        <ErrorBox message={message} />
        <div className="completion-actions">
          {open &&
            settings.allowEditAfterSubmission &&
            !settings.allowMultipleSubmissions && (
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/attempts/${attemptId}/edit`, {
                      method: "POST",
                      body: json({ revision: data.attempt.revision }),
                    });
                    navigate(`/survey/${publicId}/attempt/${attemptId}`);
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {data.attempt.isEditing ? "继续修改我的答案" : "修改我的答案"}
              </Button>
            )}
          {open && settings.allowMultipleSubmissions && (
            <Link className="btn" to={`/survey/${publicId}`}>
              再填写一次
            </Link>
          )}
          <Link className="btn secondary" to="/dashboard">
            返回工作台
          </Link>
        </div>
        <details className="my-answers">
          <summary>查看我的已保存答案</summary>
          {data.attempt.answers.map((a: any) => {
            const q = data.definition.questions.find(
                (q: any) => q.id === a.questionId,
              ),
              value = q?.options
                ? (Array.isArray(a.value) ? a.value : [a.value])
                    .map(
                      (id: string) =>
                        q.options.find((o: any) => o.id === id)?.label ?? id,
                    )
                    .join("、")
                : String(a.value);
            return (
              <div key={a.questionId}>
                <strong>{q?.title}</strong>
                <p>{value}</p>
              </div>
            );
          })}
        </details>
      </div>
    </div>
  );
}
