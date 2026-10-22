import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
import {
  BarChart3,
  Copy,
  Download,
  ExternalLink,
  RefreshCw,
  Share2,
  Users,
  FileCheck2,
} from "lucide-react";
import { api, json, useAuth, useData } from "../api.js";
import {
  Back,
  Button,
  chinaDateTimeInput,
  chinaDateTimeIso,
  dateText,
  ErrorBox,
  Loading,
  PageTitle,
  Status,
} from "../ui.js";
export function Share() {
  const linkInput = useRef<HTMLInputElement>(null);
  const { id } = useParams(),
    { data, error, loading, reload } = useData(`/surveys/${id}/share`),
    { notify } = useAuth();
  const [qr, setQr] = useState(""),
    [deadline, setDeadline] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) {
      QRCode.toDataURL(data.url, {
        width: 512,
        margin: 4,
        errorCorrectionLevel: "M",
      })
        .then(setQr)
        .catch((e) => setMessage(e.message));
      setDeadline(chinaDateTimeInput(data.deadlineAt));
    }
  }, [data]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error} />;
  return (
    <>
      <Back />
      <PageTitle
        eyebrow="GOOD QUESTIONS TRAVEL"
        title="分享你的问卷"
        description={data.title}
      >
        <Status status={data.effectiveStatus} />
        <Link className="btn secondary" to={`/surveys/${id}/results`}>
          <BarChart3 size={16} />
          查看统计
        </Link>
      </PageTitle>
      <ErrorBox message={message} />
      <div className="share-layout">
        <section className="panel share-content">
          <span className="section-kicker">
            <Share2 size={17} />
            让问卷找到它的回答者
          </span>
          <h2>复制链接，开始收集。</h2>
          <p>把链接发送给同学、朋友或群聊，填写者登录后即可作答。</p>
          <label>
            问卷公开链接
            <div className="url-input">
              <input
                ref={linkInput}
                aria-label="问卷链接"
                readOnly
                value={data.url}
              />
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(data.url);
                      notify("问卷链接已复制");
                      return;
                    }
                  } catch {
                    /* A webview may expose the API but deny permission. */
                  }
                  const input = linkInput.current;
                  if (!input) return;
                  input.focus();
                  input.select();
                  input.setSelectionRange(0, input.value.length);
                  notify("链接已选中，请长按或使用系统菜单复制");
                }}
              >
                <Copy size={15} />
                复制
              </Button>
            </div>
          </label>
          <a
            className="text-button"
            href={data.url}
            target="_blank"
            rel="noreferrer"
          >
            打开填写页面
            <ExternalLink size={14} />
          </a>
          <div className="sharing-notes">
            <h3>分享前的小提示</h3>
            <p>
              二维码和链接指向同一份问卷。已关闭或截止的问卷将停止接收新提交和修改。
            </p>
          </div>
        </section>
        <section className="panel qr-panel">
          <div className="eyebrow">SCAN & SHARE</div>
          <h2>扫一扫，听见更多声音。</h2>
          {qr && (
            <img
              src={qr}
              alt={`${data.title}的填写二维码`}
              width={240}
              height={240}
            />
          )}
          <span className="muted">{data.title}</span>
          <a className="btn secondary" href={qr} download="问卷二维码.png">
            <Download size={16} />
            下载二维码
          </a>
        </section>
      </div>
      <section className="panel management-panel">
        <h2>收集设置</h2>
        <div className="settings-grid">
          <div>
            <span className="label-text">截止时间（北京时间）</span>
            <input
              aria-label="修改截止时间"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
            <small>留空可取消截止时间；关闭后的问卷不可重新开启。</small>
            <Button
              disabled={busy || data.status === "closed"}
              variant="secondary"
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/surveys/${id}/deadline`, {
                    method: "PATCH",
                    body: json({ deadlineAt: chinaDateTimeIso(deadline) }),
                  });
                  notify("截止时间已更新");
                  await reload();
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存截止设置
            </Button>
          </div>
          <div>
            <span className="label-text">停止收集</span>
            <p className="muted">
              关闭后，链接和历史结果仍保留，填写者不能继续提交或修改。
            </p>
            <Button
              variant="danger"
              disabled={busy || data.status !== "published"}
              onClick={async () => {
                if (!confirm("确定关闭问卷？第一阶段关闭后不再开启。")) return;
                setBusy(true);
                try {
                  await api(`/surveys/${id}/close`, {
                    method: "POST",
                    body: "{}",
                  });
                  notify("问卷已关闭");
                  await reload();
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              关闭问卷
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
export function Results() {
  const { id } = useParams(),
    { data, error, loading, reload } = useData(`/surveys/${id}/stats`),
    [active, setActive] = useState("");
  useEffect(() => {
    if (data && !active) setActive(data.questions[0]?.id ?? "");
  }, [data]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error} />;
  const q = data.questions.find((q: any) => q.id === active);
  return (
    <>
      <Back />
      <PageTitle
        eyebrow="EVERY ANSWER TELLS A STORY"
        title="看见回答里的发现"
        description={data.survey.title}
      >
        <Button variant="secondary" onClick={() => void reload()}>
          <RefreshCw size={15} />
          刷新结果
        </Button>
        <Link className="btn" to={`/surveys/${id}/share`}>
          <Share2 size={15} />
          分享问卷
        </Link>
      </PageTitle>
      <div className="results-summary">
        <div className="panel">
          <FileCheck2 size={23} />
          <span>有效答卷</span>
          <strong>
            {data.totalSubmissions}
            <small>份</small>
          </strong>
        </div>
        <div className="panel">
          <Users size={23} />
          <span>去重填写人数</span>
          <strong>
            {data.uniqueRespondents}
            <small>人</small>
          </strong>
        </div>
        <div className="panel results-state">
          <Status status={data.survey.effectiveStatus} />
          <h3>{data.survey.title}</h3>
          <p>截止时间：{dateText(data.survey.deadlineAt)}</p>
        </div>
      </div>
      <p className="stat-explanation">
        同一账号重复提交会增加答卷份数，去重人数只计一次；修改原答卷会更新统计，答卷份数不增加。修改草稿不计入结果。
      </p>
      <div className="results-layout">
        <aside className="panel result-directory">
          <h3>逐题统计</h3>
          {data.questions.map((x: any, i: number) => (
            <button
              key={x.id}
              className={active === x.id ? "active" : ""}
              onClick={() => setActive(x.id)}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {x.title}
            </button>
          ))}
        </aside>
        {q && (
          <section className="panel question-results">
            <div className="eyebrow">QUESTION RESULTS</div>
            <h2>{q.title}</h2>
            <div className="question-metrics">
              <span>
                到达 <b>{q.arrivedCount}</b> 份
              </span>
              <span>
                回答 <b>{q.answeredCount}</b> 份
              </span>
              <span>
                回答者 <b>{q.uniqueRespondents}</b> 人
              </span>
              <span>
                跳过 <b>{q.skippedCount}</b> 份
              </span>
              <span>
                未填 <b>{q.unansweredCount}</b> 份
              </span>
            </div>
            {q.type.includes("choice") ? (
              <>
                <div className="bars">
                  {q.options.map((o: any) => (
                    <div className="bar-row" key={o.id}>
                      <div>
                        <strong>{o.label}</strong>
                        <span>
                          {o.count} 份 · {o.uniqueRespondents} 人
                        </span>
                      </div>
                      <div className="bar-track">
                        <div
                          style={{
                            width: `${q.answeredCount ? (o.count / q.answeredCount) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <small>
                        {q.answeredCount
                          ? ((o.count / q.answeredCount) * 100).toFixed(1)
                          : "0.0"}
                        %
                      </small>
                    </div>
                  ))}
                </div>
                <p className="muted">
                  比例以该题有效回答份数为分母。多选题的比例合计可以超过100%；同一个人可能在不同答卷中选择不同选项。
                </p>
              </>
            ) : (
              <>
                {q.type === "number" && (
                  <div className="average">
                    <small>有效数字答案的平均值</small>
                    <strong>
                      {q.average === null
                        ? "暂无数据"
                        : Number(q.average.toFixed(4))}
                    </strong>
                  </div>
                )}
                <AnswerValues key={q.id} surveyId={id!} questionId={q.id} />
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}
function AnswerValues({
  surveyId,
  questionId,
}: {
  surveyId: string;
  questionId: string;
}) {
  const [page, setPage] = useState(1),
    { data, error, loading } = useData(
      `/surveys/${surveyId}/questions/${questionId}/stats?page=${page}`,
    );
  return (
    <div className="answer-values">
      <h3>填写内容</h3>
      <ErrorBox message={error} />
      {loading ? (
        <Loading />
      ) : data?.items.length ? (
        data.items.map((x: any) => (
          <div className="answer-value" key={x._id}>
            <p>{String(x.answer.value)}</p>
            <small>
              {x.isAnonymous ? "匿名答卷" : "实名答卷"} ·{" "}
              {dateText(x.submittedAt)}
            </small>
          </div>
        ))
      ) : (
        <p className="muted">还没有收到这道题的回答。</p>
      )}
      <div className="pagination">
        <Button
          variant="secondary"
          disabled={page === 1 || loading}
          onClick={() => setPage((p) => p - 1)}
        >
          上一页
        </Button>
        <span>第 {page} 页</span>
        <Button
          variant="secondary"
          disabled={!data?.hasMore || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
