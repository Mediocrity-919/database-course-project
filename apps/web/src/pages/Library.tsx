import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  Question,
  QuestionType,
} from "../../../../packages/shared/src/domain.js";
import { api, json, useAuth, useData } from "../api.js";
import { Button, ErrorBox, Loading, PageTitle } from "../ui.js";
import { createQuestion } from "./Editor.js";
import { QuestionForm } from "../components/QuestionForm.js";

const labels: Record<QuestionType, string> = {
  single_choice: "单选题",
  multiple_choice: "多选题",
  text: "文本填空",
  number: "数字填空",
};
export function Library() {
  const [page, setPage] = useState(1),
    [bank, setBank] = useState(""),
    [selected, setSelected] = useState(""),
    [form, setForm] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const banks = useData("/question-banks"),
    list = useData(
      `/library/questions?page=${page}${bank ? "&bankId=" + bank : ""}`,
    ),
    { notify } = useAuth();
  const refresh = async () => {
    await list.reload();
    await banks.reload();
  };
  const formKey = form?.base ?? form?.from ?? (form ? "new" : "");
  useEffect(() => {
    if (formKey)
      document
        .querySelector(".library-form")
        ?.scrollIntoView({ block: "start" });
  }, [formKey]);
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="QUESTION LIBRARY"
        title="我的题库"
        description="保存常用题，选择版本复用，也可以共享给团队成员。"
      >
        <Button
          disabled={busy}
          onClick={() => {
            setForm({ content: createQuestion("number", 1) });
            setError("");
          }}
        >
          新建常用题
        </Button>
      </PageTitle>
      <ErrorBox message={error || list.error || banks.error} />
      <section className="panel library-bank">
        <h2>题库管理</h2>
        <div className="settings-grid">
          <label>
            选择题库
            <select
              aria-label="选择题库"
              value={bank}
              onChange={(e) => {
                const b = banks.data?.items.find(
                  (b: any) => b._id === e.target.value,
                );
                setBank(e.target.value);
                setName(b?.name ?? "");
                setDescription(b?.description ?? "");
                setPage(1);
              }}
            >
              <option value="">全部题目与共享题目</option>
              {banks.data?.items.map((b: any) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            题库名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </label>
          <label>
            题库说明
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
            />
          </label>
        </div>
        <div className="title-actions">
          <Button
            disabled={busy || !name.trim()}
            onClick={() =>
              work(async () => {
                await api("/question-banks", {
                  method: "POST",
                  body: json({ name, description }),
                });
                await banks.reload();
                notify("题库已创建");
              })
            }
          >
            创建题库
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !bank || !name.trim()}
            onClick={() =>
              work(async () => {
                const b = banks.data.items.find((x: any) => x._id === bank);
                await api(`/question-banks/${bank}`, {
                  method: "PUT",
                  body: json({ name, description, revision: b.revision }),
                });
                await banks.reload();
                notify("题库已更新");
              })
            }
          >
            保存题库名称和说明
          </Button>
        </div>
      </section>
      {form && (
        <section className="panel library-form">
          <h2>
            {form.base
              ? "创建新版本"
              : form.from
                ? "另存为我的题目"
                : "新建常用题"}
          </h2>
          <p className="muted">
            保存会生成独立版本。问卷跳转在使用题目时单独配置。
          </p>
          <fieldset className="question-core" disabled={busy}>
            <QuestionForm
              value={form.content}
              onChange={(content) => setForm({ ...form, content })}
            />
          </fieldset>
          <div className="title-actions">
            <Button
              disabled={busy}
              onClick={() =>
                work(async () => {
                  const result = form.base
                    ? await api(`/library/versions/${form.base}/derive`, {
                        method: "POST",
                        body: json({
                          revision: form.revision,
                          content: form.content,
                        }),
                      })
                    : await api("/library/questions", {
                        method: "POST",
                        body: json({
                          content: form.content,
                          ...(form.from ? { fromVersionId: form.from } : {}),
                        }),
                      });
                  setSelected("");
                  setForm(null);
                  await refresh();
                  setSelected(
                    result.family ? result.family._id : result.familyId,
                  );
                  notify("题目版本已保存");
                })
              }
            >
              保存题目版本
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setForm(null)}
            >
              取消
            </Button>
          </div>
        </section>
      )}
      <div className="library-layout">
        <section className="panel">
          <h2>可用题目</h2>
          {list.loading ? (
            <Loading />
          ) : (
            list.data?.items.map((f: any) => (
              <button
                className={`library-card ${selected === f._id ? "selected" : ""}`}
                key={f._id}
                onClick={() => {
                  setSelected(f._id);
                  setForm(null);
                }}
              >
                <b>{f.latest.content.title}</b>
                <span>
                  {labels[f.latest.content.type as QuestionType]} · v
                  {f.latest.versionNumber} ·{" "}
                  {f.owned ? "我的题目" : `${f.owner}共享`}
                </span>
              </button>
            ))
          )}
          {!list.loading && !list.data?.items.length && (
            <p>暂无题目，点击“新建常用题”开始。</p>
          )}
          <div className="title-actions">
            <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <span>第{page}页</span>
            <Button
              disabled={!list.data?.hasMore}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </section>
        {selected ? (
          <FamilyDetail
            key={selected}
            id={selected}
            banks={banks.data?.items ?? []}
            edit={setForm}
            refresh={refresh}
          />
        ) : (
          <section className="panel">
            <h2>版本与使用情况</h2>
            <p>选择题目查看历史、共享权限、使用问卷及跨问卷统计。</p>
          </section>
        )}
      </div>
    </>
  );
}
function FamilyDetail({
  id,
  banks,
  edit,
  refresh,
}: {
  id: string;
  banks: any[];
  edit: (v: any) => void;
  refresh: () => Promise<void>;
}) {
  const [page, setPage] = useState(1),
    d = useData(`/library/questions/${id}?page=${page}`),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [names, setNames] = useState(""),
    [ids, setIds] = useState<string[]>([]),
    [version, setVersion] = useState("");
  useEffect(() => {
    if (d.data) {
      setNames(d.data.sharedWith.map((u: any) => u.username).join(", "));
      setIds(d.data.family.bankIds);
      setVersion(d.data.versions[0]?._id ?? "");
    }
  }, [d.data]);
  if (d.loading) return <Loading />;
  if (!d.data) return <ErrorBox message={d.error} />;
  const data = d.data;
  return (
    <section className="panel">
      <h2>版本历史</h2>
      <ErrorBox message={error || d.error} />
      <p className="muted">
        不同版本可以同时使用。恢复旧版也会创建新版本，旧问卷保持原样。
      </p>
      {data.versions.map((v: any) => (
        <div
          className={`library-history ${version === v._id ? "selected" : ""}`}
          key={v._id}
        >
          <h3>
            v{v.versionNumber} · {v.content.title}
          </h3>
          <p className="muted">
            {v.restoredFromVersionId
              ? "恢复旧版生成"
              : v.parentVersionId
                ? "基于已有版本派生"
                : "初始版本"}
            {v.parentVersionId &&
              ` · 来源：${data.versions.find((x: any) => x._id === v.parentVersionId) ? "v" + data.versions.find((x: any) => x._id === v.parentVersionId).versionNumber : "其他历史版本"}`}
          </p>
          <details>
            <summary>查看版本内容与来源</summary>
            <p>
              {labels[v.content.type as QuestionType]} ·{" "}
              {v.content.required ? "必答" : "选答"} ·{" "}
              {v.content.description || "无说明"}
            </p>
            {v.content.options && (
              <ul>
                {v.content.options.map((o: any) => (
                  <li key={o.id}>{o.label}</li>
                ))}
              </ul>
            )}
            <p>
              校验：
              {Object.entries(v.content.validation)
                .map(
                  ([k, val]) =>
                    `${({ min: "最小值", max: "最大值", minLength: "最少字符", maxLength: "最多字符", minSelections: "最少选择", maxSelections: "最多选择", integerOnly: "只允许整数" } as Record<string, string>)[k]} ${val}`,
                )
                .join("；") || "按题型校验"}
            </p>
            <small className="library-lineage">
              版本ID：{v._id}
              {v.parentVersionId && `；父版本：${v.parentVersionId}`}
              {v.restoredFromVersionId &&
                `；恢复自：${v.restoredFromVersionId}`}
            </small>
          </details>
          <div className="title-actions">
            <Button
              variant="secondary"
              aria-pressed={version === v._id}
              onClick={() => {
                setVersion(v._id);
              }}
            >
              查看使用与统计
            </Button>
            {data.owned && (
              <>
                <Button
                  variant="secondary"
                  onClick={() =>
                    edit({
                      content: structuredClone(v.content),
                      base: v._id,
                      revision: data.family.revision,
                    })
                  }
                >
                  基于 v{v.versionNumber} 创建新版本
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm(`将v${v.versionNumber}恢复为一个新版本？`))
                      return;
                    setBusy(true);
                    setError("");
                    try {
                      await api(`/library/versions/${v._id}/derive`, {
                        method: "POST",
                        body: json({
                          revision: data.family.revision,
                          restore: true,
                        }),
                      });
                      await d.reload();
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  恢复 v{v.versionNumber}
                </Button>
              </>
            )}
            <Button
              variant="secondary"
              onClick={() =>
                edit({ content: structuredClone(v.content), from: v._id })
              }
            >
              另存为我的题目
            </Button>
          </div>
        </div>
      ))}
      <div className="title-actions">
        <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
          较新版本
        </Button>
        <Button disabled={!data.hasMore} onClick={() => setPage(page + 1)}>
          更早版本
        </Button>
      </div>
      {data.owned && (
        <div className="library-access">
          <h3>共享与题库归属</h3>
          <label>
            共享给这些用户名（逗号分隔）
            <input
              value={names}
              onChange={(e) => setNames(e.target.value)}
              placeholder="输入已注册的用户名"
            />
          </label>
          <p className="muted">
            共享允许使用所有版本，不授予编辑权限。清空名单可撤销共享，已经保存的问卷不受影响。
          </p>
          {banks.map((b) => (
            <label className="inline-check" key={b._id}>
              <input
                type="checkbox"
                checked={ids.includes(b._id)}
                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, b._id]
                      : ids.filter((x) => x !== b._id),
                  )
                }
              />
              {b.name}
            </label>
          ))}
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(`/library/questions/${id}/access`, {
                  method: "PUT",
                  body: json({
                    revision: data.family.revision,
                    usernames: names
                      .split(/[,，]/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                    bankIds: ids,
                  }),
                });
                await d.reload();
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            保存共享与归属
          </Button>
        </div>
      )}
      {version && (
        <VersionStats
          key={version}
          id={version}
          label={`v${data.versions.find((v: any) => v._id === version)?.versionNumber} · ${data.versions.find((v: any) => v._id === version)?.content.title}`}
        />
      )}
    </section>
  );
}
function VersionStats({ id, label }: { id: string; label: string }) {
  const [page, setPage] = useState(1),
    [scope, setScope] = useState<"version" | "family">("version"),
    usage = useData(`/library/versions/${id}/usage?scope=${scope}`),
    stats = useData(
      `/library/versions/${id}/stats?page=${page}&scope=${scope}`,
    );
  const s = stats.data;
  return (
    <div className="library-statistics">
      <h3>使用与统计：{label}</h3>
      <div className="title-actions" role="group" aria-label="统计范围">
        <Button
          variant={scope === "version" ? "" : "secondary"}
          aria-pressed={scope === "version"}
          onClick={() => {
            setScope("version");
            setPage(1);
          }}
        >
          仅此版本
        </Button>
        <Button
          variant={scope === "family" ? "" : "secondary"}
          aria-pressed={scope === "family"}
          onClick={() => {
            setScope("family");
            setPage(1);
          }}
        >
          全部版本合计
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            void usage.reload();
            void stats.reload();
          }}
        >
          刷新使用与统计
        </Button>
      </div>
      <ErrorBox message={usage.error || stats.error} />
      <p>
        {scope === "version"
          ? "仅统计此版本。"
          : "合计同题型版本的回答，并按版本列出份数；选项仅在ID和文字均相同时合并，改名选项分开列出。题意或数字单位变化时，请使用“仅此版本”统计。"}
        共享题目不自动共享答卷；其他问卷需创建者允许后才展示名称与汇总。文本原文仅来自本人问卷。
      </p>
      <h4>使用此题的问卷</h4>
      <ul>
        {usage.data?.items.map((u: any, i: number) => (
          <li key={u.id ?? i}>
            {u.owned ? (
              <Link
                to={
                  u.status === "draft"
                    ? `/surveys/${u.id}/edit`
                    : `/surveys/${u.id}/results`
                }
              >
                {u.title}
              </Link>
            ) : (
              u.title
            )}{" "}
            · {u.statisticsIncluded ? "可汇总" : "未授权汇总"}
            {!!u.versionNumbers?.length &&
              ` · 使用 v${u.versionNumbers.join("、v")}`}
          </li>
        ))}
      </ul>
      {usage.data && !usage.data.items.length && <p>暂无问卷使用。</p>}
      {s && (
        <>
          <p>
            <b>有效回答 {s.answerCount} 份</b> · 纳入 {s.surveyCount}{" "}
            份已发布问卷
          </p>
          <small>跨问卷按答案份数计算，不宣称去重人数。</small>
          {s.scope === "family" && (
            <ul className="library-version-counts">
              {s.versions.map((x: any) => (
                <li key={x.versionId}>
                  v{x.versionNumber}：{x.answerCount} 份 · {x.title}
                </li>
              ))}
              {s.excludedVersions.map((x: any) => (
                <li key={x.versionId}>
                  v{x.versionNumber} 题型为{labels[x.type as QuestionType]}
                  ，与当前版本不可比，未合并
                </li>
              ))}
            </ul>
          )}
          {s.average !== null && (
            <p>
              平均值 {s.average} · 最小值 {s.min} · 最大值 {s.max}
            </p>
          )}
          {s.options.map((o: any) => (
            <div className="library-distribution" key={o.key}>
              <span>
                {o.label}
                {s.scope === "family" &&
                  o.versionNumbers.length < s.versions.length &&
                  `（仅 v${o.versionNumbers.join("、v")}）`}
              </span>
              <meter min={0} max={Math.max(1, s.answerCount)} value={o.count} />
              <b>{o.count}</b>
            </div>
          ))}
          {s.distribution.map((b: any, i: number) => (
            <div className="library-distribution" key={i}>
              <span>
                {b._id.min} ～ {b._id.max}
                {i === s.distribution.length - 1
                  ? "（含上界）"
                  : "（不含上界）"}
              </span>
              <meter min={0} max={Math.max(1, s.answerCount)} value={b.count} />
              <b>{b.count}</b>
            </div>
          ))}
          {!!s.texts.length && (
            <>
              <h4>本人问卷中的文本答案</h4>
              <ul>
                {s.texts.map((t: any, i: number) => (
                  <li key={i}>{t.value}</li>
                ))}
              </ul>
            </>
          )}
          <div className="title-actions">
            <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
              上一页文本
            </Button>
            <Button disabled={!s.hasMore} onClick={() => setPage(page + 1)}>
              下一页文本
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
