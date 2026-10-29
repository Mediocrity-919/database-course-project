import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  FileText,
  Plus,
  Search,
  Share2,
  Pencil,
  Users,
  CheckCircle2,
  ArrowUpRight,
  Copy,
  Trash2,
} from "lucide-react";
import { api, ApiError, json, useAuth, useData } from "../api.js";
import {
  passwordIssues,
  passwordRequirements,
} from "../../../../packages/shared/src/auth.js";
import {
  Back,
  Brand,
  Button,
  dateText,
  ErrorBox,
  Loading,
  PageTitle,
  Status,
} from "../ui.js";

export function AuthPage({ register = false }: { register?: boolean }) {
  const { login, user } = useAuth(),
    navigate = useNavigate(),
    [params] = useSearchParams();
  const [username, setUsername] = useState(params.get("username") ?? ""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [errorCode, setErrorCode] = useState(""),
    [attempted, setAttempted] = useState(false),
    [busy, setBusy] = useState(false);
  const candidate = params.get("returnTo") ?? "/dashboard",
    target =
      candidate.startsWith("/") && !candidate.startsWith("//")
        ? candidate
        : "/dashboard";
  useEffect(() => {
    if (user) navigate(target, { replace: true });
  }, [user]);
  const suggestedUsername = params.get("username");
  useEffect(() => {
    setPassword("");
    setError("");
    setErrorCode("");
    setAttempted(false);
    if (suggestedUsername !== null) setUsername(suggestedUsername);
  }, [register, suggestedUsername]);
  const requirements = passwordRequirements(password);
  const registerUrl = `/register?returnTo=${encodeURIComponent(target)}&username=${encodeURIComponent(username.trim())}`;
  return (
    <div className="auth-layout">
      <div className="auth-story">
        <Brand />
        <div>
          <div className="eyebrow">A LITTLE CURIOSITY, A BIG DISCOVERY.</div>
          <h1>
            好的发现，
            <br />
            始于一个问题<span>。</span>
          </h1>
          <p>
            把想知道的，变成有意义的回答。
            <br />
            用清晰的问卷，连接每一种真实的声音。
          </p>
          <div className="story-art">
            <div className="art-card">
              <span className="small">QUESTION 01</span>
              <strong>你眼中的理想生活是什么？</strong>
              <div />
              <div />
              <div className="art-answer">
                从倾听开始 <ArrowUpRight size={16} />
              </div>
            </div>
            <span className="art-star">✳</span>
          </div>
        </div>
        <small>问笺 · 让好奇心有迹可循</small>
      </div>
      <div className="auth-form-wrap">
        <form
          className="auth-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setErrorCode("");
            setAttempted(true);
            try {
              if (register) {
                const issues = passwordIssues(password);
                if (issues.length) {
                  setError(issues.map((issue) => issue.message).join("；"));
                  return;
                }
                await api("/auth/register", {
                  method: "POST",
                  body: json({ username, password }),
                });
              }
              await login(username, password);
              navigate(target);
            } catch (e) {
              setError((e as Error).message);
              setErrorCode(e instanceof ApiError ? e.code : "");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="eyebrow">YOUR WORKSPACE AWAITS</div>
          <h2>{register ? "创建你的账号" : "欢迎回来"}</h2>
          <p>
            {register
              ? "开始收集你的第一份答案。"
              : "登录问笺，继续你的下一次发现。"}
          </p>
          <ErrorBox message={error} />
          {!register && errorCode === "USER_NOT_FOUND" && (
            <Link className="registration-prompt" to={registerUrl}>
              创建账号「{username.trim()}」<ArrowRight size={15} />
            </Link>
          )}
          <label>
            用户名
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError("");
                setErrorCode("");
              }}
              placeholder="3～32位字母、数字或下划线"
              required
              pattern="[A-Za-z0-9_]{3,32}"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              maxLength={128}
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
                setErrorCode("");
              }}
              placeholder={
                register ? "至少8位，包含大写、小写字母和数字" : "请输入密码"
              }
              aria-describedby={register ? "password-requirements" : undefined}
              aria-invalid={
                register && attempted && passwordIssues(password).length > 0
              }
              required
            />
          </label>
          {register && (
            <ul
              id="password-requirements"
              className="password-requirements"
              aria-label="密码要求"
              aria-live="polite"
            >
              {requirements.map((rule) => (
                <li
                  key={rule.id}
                  className={
                    rule.met ? "met" : password || attempted ? "missing" : ""
                  }
                >
                  <span aria-hidden="true">{rule.met ? "✓" : "○"}</span>
                  {rule.label}
                  <span className="requirement-state">
                    {rule.met ? "已满足" : "未满足"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "请稍候…" : register ? "注册并进入工作台" : "登录工作台"}
            <ArrowRight size={16} />
          </Button>
          <div className="auth-switch">
            {register ? "已有账号？" : "还没有账号？"}{" "}
            <Link
              to={
                register
                  ? `/login?returnTo=${encodeURIComponent(target)}&username=${encodeURIComponent(username.trim())}`
                  : registerUrl
              }
            >
              {register ? "去登录" : "创建账号"}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
export function NewSurvey() {
  const navigate = useNavigate(),
    started = useRef(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api("/surveys", { method: "POST", body: "{}" })
      .then((s) => navigate(`/surveys/${s._id}/edit`, { replace: true }))
      .catch((e) => setError(e.message));
  }, []);
  return error ? <ErrorBox message={error} /> : <Loading />;
}
export function Dashboard() {
  const { data, error, loading, reload, setData } = useData("/surveys"),
    { notify } = useAuth();
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [actionError, setActionError] = useState("");
  const items: any[] = data?.items ?? [],
    shown = items.filter(
      (s) =>
        (filter === "all" || s.effectiveStatus === filter) &&
        s.title.toLowerCase().includes(search.toLowerCase()),
    );
  const copy = async (id: string) => {
    try {
      const s = await api(`/surveys/${id}/copy`, {
        method: "POST",
        body: "{}",
      });
      notify("已复制为新草稿");
      await reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="YOUR IDEAS, THEIR VOICES"
        title="我的问卷"
        description="从提问到发现，在这里管理你的每一份问卷。"
      >
        <Link className="btn" to="/new">
          <Plus size={17} />
          新建问卷
        </Link>
      </PageTitle>
      <div className="welcome-banner">
        <div>
          <span className="eyebrow">MAKE ROOM FOR NEW PERSPECTIVES</span>
          <h2>每一个好问题，都值得被认真回答。</h2>
          <p>设置题目与逻辑，分享你的问卷，让真实的想法被看见。</p>
          <Link to="/new">
            开始一份新问卷 <ArrowRight size={16} />
          </Link>
        </div>
        <div className="banner-art">
          <span>✳</span>
          <div className="mini-paper">
            <div />
            <div />
            <div />
            <div />
            <b>✓</b>
          </div>
        </div>
      </div>
      <div className="metrics">
        <div>
          <span className="metric-icon">
            <FileText size={20} />
          </span>
          <div>
            <small>问卷总数{data?.nextCursor ? "（已加载）" : ""}</small>
            <strong>{items.length.toString().padStart(2, "0")}</strong>
          </div>
        </div>
        <div>
          <span className="metric-icon">
            <CheckCircle2 size={20} />
          </span>
          <div>
            <small>正在收集</small>
            <strong>
              {items
                .filter((x) => x.effectiveStatus === "published")
                .length.toString()
                .padStart(2, "0")}
            </strong>
          </div>
        </div>
        <div>
          <span className="metric-icon">
            <BarChart3 size={20} />
          </span>
          <div>
            <small>有效答卷</small>
            <strong>
              {items
                .reduce((s, x) => s + x.totalSubmissions, 0)
                .toString()
                .padStart(2, "0")}
            </strong>
          </div>
        </div>
        <div>
          <span className="metric-icon">
            <Users size={20} />
          </span>
          <div>
            <small>填写人数（各卷去重后合计）</small>
            <strong>
              {items
                .reduce((s, x) => s + x.uniqueRespondents, 0)
                .toString()
                .padStart(2, "0")}
            </strong>
          </div>
        </div>
      </div>
      <section className="survey-section">
        <div className="list-tools">
          <div className="tabs">
            {[
              ["all", "全部问卷"],
              ["published", "收集中"],
              ["draft", "草稿"],
              ["closed", "已关闭"],
              ["expired", "已截止"],
            ].map(([v, t]) => (
              <button
                className={filter === v ? "selected" : ""}
                onClick={() => setFilter(v)}
                key={v}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="search">
            <Search size={16} />
            <input
              aria-label="搜索问卷"
              placeholder="搜索问卷标题…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <ErrorBox message={error || actionError} />
        {loading ? (
          <Loading />
        ) : shown.length ? (
          <div className="survey-grid">
            {shown.map((s) => (
              <article className="survey-card" key={s._id}>
                <div className="card-top">
                  <span className="document-icon">
                    <FileText size={23} />
                  </span>
                  <Status status={s.effectiveStatus} />
                </div>
                <Link
                  className="card-title"
                  to={`/surveys/${s._id}/${s.status === "draft" ? "edit" : "results"}`}
                >
                  {s.title}
                </Link>
                <p className="card-date">更新于 {dateText(s.updatedAt)}</p>
                <div className="card-count">
                  <strong>{s.totalSubmissions}</strong>
                  <span>份答卷</span>
                  <i />
                  <span>{s.uniqueRespondents} 人填写</span>
                </div>
                <div className="card-actions">
                  {s.status === "draft" ? (
                    <Link to={`/surveys/${s._id}/edit`}>
                      <Pencil size={14} />
                      编辑
                    </Link>
                  ) : (
                    <>
                      <Link to={`/surveys/${s._id}/results`}>
                        <BarChart3 size={14} />
                        统计
                      </Link>
                      <Link to={`/surveys/${s._id}/share`}>
                        <Share2 size={14} />
                        分享
                      </Link>
                    </>
                  )}
                  <button title="复制为新问卷" onClick={() => void copy(s._id)}>
                    <Copy size={14} />
                    <span>复制</span>
                  </button>
                  {s.status === "draft" && (
                    <button
                      title="删除草稿"
                      onClick={async () => {
                        if (!confirm("删除这份尚未发布的草稿？")) return;
                        try {
                          await api(`/surveys/${s._id}`, {
                            method: "DELETE",
                            body: "{}",
                          });
                          await reload();
                        } catch (e) {
                          setActionError((e as Error).message);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </article>
            ))}
            <Link className="new-card" to="/new">
              <span>
                <Plus size={24} />
              </span>
              <strong>创建新的问卷</strong>
              <p>把新的好奇，变成下一次发现</p>
            </Link>
          </div>
        ) : (
          <div className="empty-state">
            <FileText size={38} />
            <h3>
              {search || filter !== "all"
                ? "暂无符合条件的问卷"
                : "你的第一份问卷，正等着开始"}
            </h3>
            <p>从一个问题出发，听见更多不同的想法。</p>
            <Link className="btn" to="/new">
              <Plus size={16} />
              创建问卷
            </Link>
          </div>
        )}
        {data?.nextCursor && (
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const next = await api(
                  `/surveys?cursor=${encodeURIComponent(data.nextCursor)}`,
                );
                setData({ ...next, items: [...items, ...next.items] });
              } catch (e) {
                setActionError((e as Error).message);
              }
            }}
          >
            加载更多
          </Button>
        )}
      </section>
    </>
  );
}
export function Guide() {
  return (
    <>
      <Back />
      <PageTitle
        eyebrow="A SMALL GUIDE"
        title="把问题变成发现"
        description="完成一份问卷，只需要几个清晰的步骤。"
      />
      <div className="guide-grid">
        {[
          [
            "01",
            "创建与设置",
            "添加单选、多选、文字和数字题，设置必答、数量、长度或数值范围。",
          ],
          [
            "02",
            "安排回答路径",
            "在题目下添加条件，按选项或数字跳到后续题目，也可以提前结束。多条规则按优先级执行。",
          ],
          [
            "03",
            "选择填写方式",
            "单次填写可允许修改原答卷；重复填写每次生成新答卷。匿名填写仍需登录，创建者看不到账号身份。",
          ],
          [
            "04",
            "预览并发布",
            "预览不会产生答卷。发布后题目与规则锁定，避免改变历史答案的含义；需要新内容时复制为新问卷。",
          ],
          [
            "05",
            "分享与收集",
            "复制 URL 或下载二维码。手机访问需要使用实际可达的地址；跨网络分享可使用 Cloudflare Tunnel。",
          ],
          [
            "06",
            "阅读结果",
            "查看答卷份数、去重人数、选项分布、文本内容与数字平均值。修改原答卷后统计自动更新。",
          ],
          [
            "07",
            "题库与版本",
            "在我的题库保存常用题，按用户名共享；问卷从题库选择固定版本。修改或恢复都会生成新版本，已发布问卷保持原样。",
          ],
          [
            "08",
            "跨问卷观察",
            "选中题目版本可查看使用问卷和汇总结果。其他作者的问卷需明确授权汇总，文本原文仅展示本人问卷中的回答。",
          ],
        ].map(([n, title, body]) => (
          <article className="panel" key={n}>
            <span className="eyebrow">STEP {n}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </>
  );
}
