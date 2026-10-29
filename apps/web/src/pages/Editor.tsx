import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  CircleDot,
  Copy,
  Eye,
  ListChecks,
  Plus,
  Send,
  Trash2,
  Type,
  Hash,
  GitBranch,
  Save,
} from "lucide-react";
import {
  type Definition,
  type Question,
  type QuestionType,
  type Rule,
  type Action,
  validateDefinition,
} from "../../../../packages/shared/src/domain.js";
import { api, json, useAuth, useData } from "../api.js";
import {
  Back,
  Button,
  chinaDateTimeInput,
  chinaDateTimeIso,
  ErrorBox,
  Loading,
  PageTitle,
} from "../ui.js";
import { Runner } from "../components/Runner.js";
import { LibraryPicker } from "../components/LibraryPicker.js";
import { QuestionForm } from "../components/QuestionForm.js";
import { sameCore } from "../../../../packages/shared/src/library.js";
import { createUuid } from "../uuid.js";
const titles: Record<QuestionType, string> = {
  single_choice: "单选题",
  multiple_choice: "多选题",
  text: "文本填空",
  number: "数字填空",
};
const icons = {
  single_choice: CircleDot,
  multiple_choice: ListChecks,
  text: Type,
  number: Hash,
};
export function createQuestion(type: QuestionType, order: number): Question {
  return {
    id: createUuid(),
    order,
    type,
    title: `新${titles[type]}`,
    description: "",
    required: true,
    ...(type.includes("choice")
      ? {
          options: [1, 2].map((n) => ({
            id: createUuid(),
            label: `选项 ${n}`,
            order: n,
          })),
        }
      : {}),
    validation:
      type === "text"
        ? { maxLength: 500 }
        : type === "number"
          ? { integerOnly: false }
          : type === "multiple_choice"
            ? { minSelections: 1, maxSelections: 2 }
            : {},
    logic: {
      matchMode: "first_match",
      rules: [],
      defaultAction: { action: "next" },
    },
  };
}
const localTime = chinaDateTimeInput;
export function Editor({ preview = false }: { preview?: boolean }) {
  const { id } = useParams(),
    navigate = useNavigate(),
    { notify } = useAuth(),
    { data, loading, error } = useData(`/surveys/${id}`);
  const [def, setDef] = useState<Definition | null>(null),
    [revision, setRevision] = useState(1),
    [deadline, setDeadline] = useState(""),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [dirty, setDirty] = useState(false),
    [previewDone, setPreviewDone] = useState(false),
    [sourceEdit, setSourceEdit] = useState<{
      id: string;
      content: Question;
    } | null>(null);
  const editSequence = useRef(0);
  // Async imports must apply to the current draft, not the render that started them.
  const latestDef = useRef<Definition | null>(null);
  const setDefinition = (next: Definition) => {
    latestDef.current = next;
    setDef(next);
  };
  useEffect(() => {
    if (data) {
      setDefinition(data.definition);
      setRevision(data.revision);
      setDeadline(localTime(data.deadlineAt));
      setSelected(data.definition.questions[0]?.id ?? "");
      setDirty(false);
    }
  }, [data]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  if (loading || !def)
    return error ? <ErrorBox message={error} /> : <Loading />;
  const update = (next: Definition) => {
    editSequence.current++;
    setDefinition(next);
    setDirty(true);
    setMessage("");
  };
  const q = def.questions.find((q) => q.id === selected);
  const patchQ = (next: Question) =>
    update({
      ...def,
      questions: def.questions.map((q) => (q.id === next.id ? next : q)),
    });
  const add = (type: QuestionType) => {
    if (def.questions.length >= 100) {
      setMessage("每份问卷最多100道题目");
      return;
    }
    const q = createQuestion(type, def.questions.length + 1);
    update({ ...def, questions: [...def.questions, q] });
    setSelected(q.id);
  };
  const useLibraryQuestion = (next: Question, replaced?: Question) => {
    const current = latestDef.current!;
    if (
      current.questions.some(
        (t) =>
          t.id !== replaced?.id &&
          t.source?.versionId === next.source?.versionId,
      )
    )
      throw new Error("此版本已在本问卷中使用，请选择其他版本");
    if (!replaced && current.questions.length >= 100)
      throw new Error("每份问卷最多100道题目");
    if (replaced) {
      if (
        !confirm(
          "替换会重置此题的条件跳转。其他题目指向此题的跳转会保留，是否继续？",
        )
      )
        return;
      replaceQuestion(replaced, { ...next, order: replaced.order });
    } else {
      update({
        ...current,
        questions: [
          ...current.questions,
          { ...next, order: current.questions.length + 1 },
        ],
      });
      setSelected(next.id);
    }
  };
  const replaceQuestion = (old: Question, next: Question) => {
    const current = latestDef.current!;
    const target = current.questions.find((t) => t.id === old.id);
    if (!target || target.source?.versionId !== old.source?.versionId)
      throw new Error(
        "原题已删除或替换，本次未修改问卷；已创建的版本仍可在题库中选择。",
      );
    if (
      next.source &&
      current.questions.some(
        (t) =>
          t.id !== old.id && t.source?.versionId === next.source!.versionId,
      )
    )
      throw new Error("此版本已在本问卷中使用，请选择其他版本");
    const redirect = (a: Action): Action =>
      a.targetQuestionId === old.id ? { ...a, targetQuestionId: next.id } : a;
    const questions = current.questions
      .map((t) => (t.id === old.id ? { ...next, order: t.order } : t))
      .map((t) => ({
        ...t,
        logic: {
          ...t.logic,
          defaultAction: redirect(t.logic.defaultAction),
          rules: t.logic.rules.map((r) => ({ ...r, then: redirect(r.then) })),
        },
      }));
    update({ ...current, questions });
    setSelected((selectedId) => (selectedId === old.id ? next.id : selectedId));
  };
  const save = async () => {
    setMessage("");
    const savedSequence = editSequence.current;
    const parsed = validateDefinition(def);
    const saved = await api(`/surveys/${id}/draft`, {
      method: "PUT",
      body: json({
        revision,
        definition: parsed,
        deadlineAt: chinaDateTimeIso(deadline),
      }),
    });
    setRevision(saved.revision);
    if (savedSequence !== editSequence.current) {
      setMessage("之前的内容已保存，新增修改尚未保存，请再次保存。");
      return null;
    }
    setDefinition(saved.draft);
    setDirty(false);
    return saved;
  };
  if (preview)
    return (
      <>
        <Back to={`/surveys/${id}/edit`} />
        <PageTitle
          eyebrow="PREVIEW YOUR QUESTIONS"
          title={def.title}
          description="当前展示已保存的定义，填写不会产生答卷。"
        />
        {previewDone ? (
          <div className="panel empty-state">
            <h2>预览完成</h2>
            <Button onClick={() => setPreviewDone(false)}>重新预览</Button>
          </div>
        ) : (
          <div className="panel">
            <Runner
              definition={def}
              preview
              onSubmit={async () => setPreviewDone(true)}
            />
          </div>
        )}
      </>
    );
  if (data.status !== "draft")
    return (
      <>
        <Back />
        <PageTitle
          eyebrow="PUBLISHED SURVEY"
          title={def.title}
          description="发布定义已锁定。你可以查看统计、分享，或复制成新的草稿。"
        />
        <Link className="btn" to={`/surveys/${id}/results`}>
          查看统计
        </Link>
        <Link className="btn secondary" to={`/surveys/${id}/share`}>
          分享与管理
        </Link>
      </>
    );
  return (
    <>
      <Back />
      <PageTitle
        eyebrow="SHAPE YOUR NEXT DISCOVERY"
        title="设计问卷"
        description="先整理问题，再为不同的答案安排合适的路径。"
      >
        <span className="save-label">
          {dirty ? "有未保存的修改" : "已保存"}
        </span>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (await save()) notify("草稿已保存");
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Save size={15} />
          保存
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (await save()) navigate(`/surveys/${id}/preview`);
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Eye size={15} />
          预览
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage("");
            try {
              validateDefinition(def, true);
              if (!confirm("发布后题目和填写规则将锁定，确定发布？")) return;
              const saved = await save();
              if (!saved) return;
              await api(`/surveys/${id}/publish`, {
                method: "POST",
                body: json({ revision: saved.revision }),
              });
              notify("问卷已发布，可以开始分享");
              navigate(`/surveys/${id}/share`);
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Send size={15} />
          发布问卷
        </Button>
      </PageTitle>
      <ErrorBox message={message} />
      <section className="panel survey-settings">
        <div className="section-heading">
          <span className="step-dot">01</span>
          <h2>问卷基本信息</h2>
        </div>
        <label>
          问卷标题
          <input
            aria-label="问卷标题"
            value={def.title}
            maxLength={100}
            onFocus={(e) => {
              if (def.title === "未命名问卷") e.currentTarget.select();
            }}
            onChange={(e) => update({ ...def, title: e.target.value })}
          />
        </label>
        <label>
          问卷说明
          <textarea
            rows={2}
            maxLength={2000}
            value={def.description}
            onChange={(e) => update({ ...def, description: e.target.value })}
            placeholder="告诉填写者，这份问卷关于什么…"
          />
        </label>
        <div className="settings-grid">
          <label>
            截止时间（北京时间）
            <input
              type="datetime-local"
              aria-label="截止时间"
              value={deadline}
              onChange={(e) => {
                editSequence.current++;
                setDeadline(e.target.value);
                setDirty(true);
              }}
            />
            <small>留空表示长期收集，直到手动关闭。</small>
          </label>
          <div>
            <span className="label-text">填写策略</span>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={def.settings.allowAnonymous}
                onChange={(e) =>
                  update({
                    ...def,
                    settings: {
                      ...def.settings,
                      allowAnonymous: e.target.checked,
                    },
                  })
                }
              />
              允许匿名提交（仍需登录）
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={def.settings.allowMultipleSubmissions}
                onChange={(e) =>
                  update({
                    ...def,
                    settings: {
                      ...def.settings,
                      allowMultipleSubmissions: e.target.checked,
                      allowEditAfterSubmission: !e.target.checked,
                    },
                  })
                }
              />
              允许重复填写，每次生成新答卷
            </label>
            {!def.settings.allowMultipleSubmissions && (
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={def.settings.allowEditAfterSubmission}
                  onChange={(e) =>
                    update({
                      ...def,
                      settings: {
                        ...def.settings,
                        allowEditAfterSubmission: e.target.checked,
                      },
                    })
                  }
                />
                提交后允许修改原答卷
              </label>
            )}
          </div>
        </div>
        <label className="inline-check library-consent">
          <input
            type="checkbox"
            checked={def.settings.shareLibraryStatistics ?? false}
            onChange={(e) =>
              update({
                ...def,
                settings: {
                  ...def.settings,
                  shareLibraryStatistics: e.target.checked,
                },
              })
            }
          />
          允许题目作者查看本问卷名称及题库题目的汇总统计（不共享填写者身份或文本原文）
        </label>
      </section>
      <div className="editor-layout">
        <aside className="panel question-directory">
          <div className="section-heading">
            <span className="step-dot">02</span>
            <h2>题目目录</h2>
            <span className="count-pill">{def.questions.length}</span>
          </div>
          {def.questions.map((t, i) => {
            const Icon = icons[t.type];
            return (
              <button
                className={`question-tab ${selected === t.id ? "active" : ""}`}
                key={t.id}
                onClick={() => setSelected(t.id)}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                <Icon size={15} />
                <b>{t.title}</b>
              </button>
            );
          })}
          <div className="add-question">
            <small>添加题目</small>
            {(Object.keys(titles) as QuestionType[]).map((t) => {
              const Icon = icons[t];
              return (
                <button key={t} onClick={() => add(t)}>
                  <Icon size={16} />
                  {titles[t]}
                  <Plus size={14} />
                </button>
              );
            })}
          </div>
          <LibraryPicker onSelect={(next) => useLibraryQuestion(next)} />
          <Link
            className="text-button"
            to="/library"
            target="_blank"
            rel="noopener noreferrer"
          >
            管理我的题库
          </Link>
        </aside>
        <section className="panel question-config">
          {q ? (
            <>
              <div className="question-config-head">
                <div className="eyebrow">
                  QUESTION {String(q.order).padStart(2, "0")}
                </div>
                <div className="icon-actions">
                  <button
                    title="上移"
                    disabled={q.order === 1}
                    onClick={() => {
                      const arr = [...def.questions],
                        i = arr.findIndex((x) => x.id === q.id);
                      [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                      update({
                        ...def,
                        questions: arr.map((x, i) => ({ ...x, order: i + 1 })),
                      });
                    }}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    title="下移"
                    disabled={q.order === def.questions.length}
                    onClick={() => {
                      const arr = [...def.questions],
                        i = arr.findIndex((x) => x.id === q.id);
                      [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
                      update({
                        ...def,
                        questions: arr.map((x, i) => ({ ...x, order: i + 1 })),
                      });
                    }}
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    title="删除题目"
                    onClick={() => {
                      const referenced = def.questions.some(
                        (t) =>
                          t.id !== q.id &&
                          (t.logic.defaultAction.targetQuestionId === q.id ||
                            t.logic.rules.some(
                              (r) => r.then.targetQuestionId === q.id,
                            )),
                      );
                      if (referenced) {
                        setMessage("其他题目仍跳转到此题，请先修改引用规则");
                        return;
                      }
                      const rest = def.questions
                        .filter((t) => t.id !== q.id)
                        .map((t, i) => ({ ...t, order: i + 1 }));
                      update({ ...def, questions: rest });
                      setSelected(rest[0]?.id ?? "");
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="library-source">
                {q.source ? (
                  <>
                    <p>
                      此题来自题库，绑定固定版本。需要修改时可以选择：保存为题库新版本（原版本和已用它的问卷不变），或解除关联只改本问卷；跳转规则可在本问卷单独设置。
                    </p>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        setSourceEdit({ id: q.id, content: structuredClone(q) })
                      }
                    >
                      修改内容并保存为题库新版本
                    </Button>
                    <LibraryPicker
                      key={q.id}
                      label="替换为题库中的版本"
                      onSelect={(next) => useLibraryQuestion(next, q)}
                    />
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (
                          !confirm(
                            "解除关联后将成为新题目，不再计入原版本的跨问卷统计，是否继续？",
                          )
                        )
                          return;
                        const next = {
                          ...structuredClone(q),
                          id: createUuid(),
                        };
                        delete next.source;
                        replaceQuestion(q, next);
                      }}
                    >
                      解除关联并编辑副本
                    </Button>
                    {sourceEdit?.id === q.id && (
                      <div className="library-source-edit">
                        <p className="muted">
                          保存后在题库生成新版本并用它替换本题（本题跳转会重置）。原版本、其他问卷和已收集的答卷都保持不变。共享给你的题目会另存为你名下的新题目。
                        </p>
                        <fieldset className="question-core" disabled={busy}>
                          <QuestionForm
                            value={sourceEdit.content}
                            onChange={(content) =>
                              setSourceEdit({ id: q.id, content })
                            }
                          />
                        </fieldset>
                        <div className="title-actions">
                          <Button
                            disabled={busy}
                            onClick={async () => {
                              const source = q.source!;
                              if (sameCore(sourceEdit.content, q)) {
                                setMessage("内容没有变化，无需创建新版本");
                                return;
                              }
                              if (
                                !confirm(
                                  "将在题库生成新版本，并用新版本替换本题（本题跳转会重置）。原版本与已发布问卷不变，是否继续？",
                                )
                              )
                                return;
                              setBusy(true);
                              setMessage("");
                              try {
                                const family = await api(
                                  `/library/questions/${source.familyId}`,
                                );
                                const created = family.owned
                                  ? await api(
                                      `/library/versions/${source.versionId}/derive`,
                                      {
                                        method: "POST",
                                        body: json({
                                          revision: family.family.revision,
                                          content: sourceEdit.content,
                                        }),
                                      },
                                    )
                                  : (
                                      await api("/library/questions", {
                                        method: "POST",
                                        body: json({
                                          content: sourceEdit.content,
                                          fromVersionId: source.versionId,
                                        }),
                                      })
                                    ).version;
                                const next = await api<Question>(
                                  `/library/versions/${created._id}/import`,
                                  { method: "POST", body: json({}) },
                                );
                                replaceQuestion(q, { ...next, order: q.order });
                                setSourceEdit(null);
                                notify(
                                  family.owned
                                    ? `已生成题库 v${created.versionNumber} 并替换本题，请保存问卷`
                                    : "已另存为你名下的新题目并替换本题，请保存问卷",
                                );
                              } catch (e) {
                                setMessage((e as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            保存为新版本并替换
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => setSourceEdit(null)}
                          >
                            取消修改
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setMessage("");
                      try {
                        await api("/library/questions", {
                          method: "POST",
                          body: json({ content: q }),
                        });
                        notify(
                          "已保存到我的题库，可通过选题入口复用；当前问卷保持独立题目。",
                        );
                      } catch (e) {
                        setMessage((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    存为常用题
                  </Button>
                )}
              </div>
              <fieldset className="question-core" disabled={!!q.source}>
                <label>
                  题目标题
                  <input
                    aria-label="题目标题"
                    value={q.title}
                    onFocus={(e) => {
                      if (
                        Object.values(titles).some(
                          (title) => q.title === `新${title}`,
                        )
                      )
                        e.currentTarget.select();
                    }}
                    onChange={(e) => patchQ({ ...q, title: e.target.value })}
                  />
                </label>
                <div className="form-row">
                  <label>
                    题型
                    <select
                      value={q.type}
                      onChange={(e) => {
                        const next = createQuestion(
                          e.target.value as QuestionType,
                          q.order,
                        );
                        patchQ({
                          ...next,
                          id: q.id,
                          title: q.title,
                          description: q.description,
                        });
                      }}
                    >
                      {Object.entries(titles).map(([v, t]) => (
                        <option key={v} value={v}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-check required-toggle">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) =>
                        patchQ({ ...q, required: e.target.checked })
                      }
                    />
                    此题必答
                  </label>
                </div>
                <label>
                  题目说明（选填）
                  <input
                    value={q.description}
                    onChange={(e) =>
                      patchQ({ ...q, description: e.target.value })
                    }
                  />
                </label>
                {q.options && (
                  <div className="option-editor">
                    <span className="label-text">选项</span>
                    {q.options.map((o, i) => (
                      <div className="option-row" key={o.id}>
                        <span>{String.fromCharCode(65 + i)}</span>
                        <input
                          aria-label={`选项 ${i + 1}`}
                          value={o.label}
                          onFocus={(e) => {
                            if (/^选项 [1-9]\d*$/.test(o.label))
                              e.currentTarget.select();
                          }}
                          onChange={(e) =>
                            patchQ({
                              ...q,
                              options: q.options!.map((t) =>
                                t.id === o.id
                                  ? { ...t, label: e.target.value }
                                  : t,
                              ),
                            })
                          }
                        />
                        <button
                          title="删除选项"
                          onClick={() => {
                            if (
                              q.logic.rules.some(
                                (r) =>
                                  r.when.value === o.id ||
                                  (Array.isArray(r.when.value) &&
                                    r.when.value.includes(o.id)),
                              )
                            ) {
                              setMessage("跳转规则仍引用此选项，请先修改规则");
                              return;
                            }
                            patchQ({
                              ...q,
                              options: q
                                .options!.filter((t) => t.id !== o.id)
                                .map((t, i) => ({ ...t, order: i + 1 })),
                            });
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="text-button"
                      onClick={() =>
                        patchQ({
                          ...q,
                          options: [
                            ...q.options!,
                            {
                              id: createUuid(),
                              label: `选项 ${q.options!.length + 1}`,
                              order: q.options!.length + 1,
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={14} />
                      添加选项
                    </button>
                  </div>
                )}
                <div className="validation-settings">
                  <h3>答案校验</h3>
                  <div className="form-row">
                    {(q.type === "multiple_choice"
                      ? ["minSelections", "maxSelections"]
                      : q.type === "text"
                        ? ["minLength", "maxLength"]
                        : q.type === "number"
                          ? ["min", "max"]
                          : []
                    ).map((key) => (
                      <label key={key}>
                        {
                          {
                            minSelections: "最少选择",
                            maxSelections: "最多选择",
                            minLength: "最少字符",
                            maxLength: "最多字符",
                            min: "最小值",
                            max: "最大值",
                          }[key]
                        }
                        <input
                          type="number"
                          value={
                            (q.validation as Record<string, number>)[key] ?? ""
                          }
                          onChange={(e) => {
                            const validation = { ...q.validation };
                            if (e.target.value === "")
                              delete (validation as Record<string, unknown>)[
                                key
                              ];
                            else
                              (validation as Record<string, unknown>)[key] =
                                e.target.valueAsNumber;
                            patchQ({ ...q, validation });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  {q.type === "number" && (
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={q.validation.integerOnly ?? false}
                        onChange={(e) =>
                          patchQ({
                            ...q,
                            validation: {
                              ...q.validation,
                              integerOnly: e.target.checked,
                            },
                          })
                        }
                      />
                      必须为整数
                    </label>
                  )}
                  {q.type === "single_choice" && (
                    <p className="muted">选择一个有效选项；必答题不能留空。</p>
                  )}
                </div>
              </fieldset>
              <div className="logic-section">
                <div className="section-heading">
                  <GitBranch size={18} />
                  <h3>条件跳转</h3>
                </div>
                <p className="muted">
                  规则从上到下匹配，第一条命中后执行。只可跳到后续题目。
                </p>
                {q.logic.rules.map((r, i) => (
                  <RuleEditor
                    key={r.id}
                    q={q}
                    def={def}
                    rule={r}
                    onChange={(next) =>
                      patchQ({
                        ...q,
                        logic: {
                          ...q.logic,
                          rules: q.logic.rules.map((t) =>
                            t.id === r.id ? next : t,
                          ),
                        },
                      })
                    }
                    onRemove={() =>
                      patchQ({
                        ...q,
                        logic: {
                          ...q.logic,
                          rules: q.logic.rules
                            .filter((t) => t.id !== r.id)
                            .map((t, i) => ({ ...t, priority: i + 1 })),
                        },
                      })
                    }
                    onUp={
                      i
                        ? () => {
                            const rules = [...q.logic.rules];
                            [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]];
                            patchQ({
                              ...q,
                              logic: {
                                ...q.logic,
                                rules: rules.map((r, i) => ({
                                  ...r,
                                  priority: i + 1,
                                })),
                              },
                            });
                          }
                        : undefined
                    }
                  />
                ))}
                {q.type !== "text" && (
                  <button
                    className="text-button"
                    onClick={() => {
                      const rule: Rule = {
                        id: createUuid(),
                        priority: q.logic.rules.length + 1,
                        when: {
                          operator:
                            q.type === "multiple_choice"
                              ? "contains_any"
                              : q.type === "number"
                                ? "gte"
                                : "eq",
                          value:
                            q.type === "multiple_choice"
                              ? [q.options![0].id]
                              : q.type === "number"
                                ? 0
                                : q.options![0].id,
                        },
                        then: { action: "end" },
                      };
                      patchQ({
                        ...q,
                        logic: { ...q.logic, rules: [...q.logic.rules, rule] },
                      });
                    }}
                  >
                    <Plus size={14} />
                    添加条件
                  </button>
                )}
                <div className="default-action">
                  <span>未命中条件时</span>
                  <ActionEditor
                    q={q}
                    def={def}
                    action={q.logic.defaultAction}
                    onChange={(action) =>
                      patchQ({
                        ...q,
                        logic: { ...q.logic, defaultAction: action },
                      })
                    }
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Plus size={36} />
              <h3>请选择题型，添加第一道题目</h3>
              <p>支持单选、多选、文本和数字填空。</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
function ActionEditor({
  q,
  def,
  action,
  onChange,
}: {
  q: Question;
  def: Definition;
  action: Action;
  onChange: (a: Action) => void;
}) {
  const targets = def.questions.filter((t) => t.order > q.order);
  return (
    <div className="action-picker">
      <select
        aria-label="跳转动作"
        value={action.action}
        onChange={(e) =>
          onChange(
            e.target.value === "goto"
              ? { action: "goto", targetQuestionId: targets[0]?.id }
              : { action: e.target.value as Action["action"] },
          )
        }
      >
        <option value="next">下一题</option>
        <option value="end">结束问卷</option>
        {targets.length > 0 && <option value="goto">跳到指定题</option>}
      </select>
      {action.action === "goto" && (
        <select
          aria-label="跳转目标题"
          value={action.targetQuestionId ?? ""}
          onChange={(e) =>
            onChange({ ...action, targetQuestionId: e.target.value })
          }
        >
          <option value="">选择目标题</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.order}. {t.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
function RuleEditor({
  q,
  def,
  rule,
  onChange,
  onRemove,
  onUp,
}: {
  q: Question;
  def: Definition;
  rule: Rule;
  onChange: (r: Rule) => void;
  onRemove: () => void;
  onUp?: () => void;
}) {
  const ops =
    q.type === "single_choice"
      ? [["eq", "等于"]]
      : q.type === "multiple_choice"
        ? [
            ["contains_any", "包含任一"],
            ["contains_all", "包含全部"],
            ["equals_set", "恰好为"],
          ]
        : [
            ["eq", "等于"],
            ["gt", "大于"],
            ["gte", "大于等于"],
            ["lt", "小于"],
            ["lte", "小于等于"],
            ["between", "介于（含边界）"],
          ];
  return (
    <div className="rule-card">
      <div className="rule-card-head">
        <strong>规则 {rule.priority}</strong>
        <div className="icon-actions">
          {onUp && (
            <button title="提高优先级" onClick={onUp}>
              <ArrowUp size={14} />
            </button>
          )}
          <button title="删除规则" onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="rule-condition">
        <span>如果答案</span>
        <select
          aria-label="条件操作符"
          value={rule.when.operator}
          onChange={(e) =>
            onChange({
              ...rule,
              when: {
                operator: e.target.value as Rule["when"]["operator"],
                value:
                  e.target.value === "between"
                    ? { min: 0, max: 10 }
                    : q.type === "number"
                      ? 0
                      : rule.when.value,
              },
            })
          }
        >
          {ops.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
        {q.type === "single_choice" ? (
          <select
            aria-label="条件选项"
            value={rule.when.value as string}
            onChange={(e) =>
              onChange({
                ...rule,
                when: { ...rule.when, value: e.target.value },
              })
            }
          >
            {q.options!.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        ) : q.type === "multiple_choice" ? (
          <div>
            {q.options!.map((o) => (
              <label className="inline-check" key={o.id}>
                <input
                  type="checkbox"
                  checked={
                    Array.isArray(rule.when.value) &&
                    rule.when.value.includes(o.id)
                  }
                  onChange={(e) => {
                    const old = Array.isArray(rule.when.value)
                      ? rule.when.value
                      : [];
                    onChange({
                      ...rule,
                      when: {
                        ...rule.when,
                        value: e.target.checked
                          ? [...old, o.id]
                          : old.filter((x) => x !== o.id),
                      },
                    });
                  }}
                />
                {o.label}
              </label>
            ))}
          </div>
        ) : rule.when.operator === "between" ? (
          <div className="form-row">
            {(["min", "max"] as const).map((k) => (
              <input
                key={k}
                type="number"
                aria-label={k === "min" ? "条件下界" : "条件上界"}
                value={(rule.when.value as { min: number; max: number })[k]}
                onChange={(e) =>
                  onChange({
                    ...rule,
                    when: {
                      ...rule.when,
                      value: {
                        ...(rule.when.value as { min: number; max: number }),
                        [k]: e.target.valueAsNumber,
                      },
                    },
                  })
                }
              />
            ))}
          </div>
        ) : (
          <input
            type="number"
            aria-label="条件数值"
            value={rule.when.value as number}
            onChange={(e) =>
              onChange({
                ...rule,
                when: { ...rule.when, value: e.target.valueAsNumber },
              })
            }
          />
        )}
      </div>
      <div className="default-action">
        <span>则</span>
        <ActionEditor
          q={q}
          def={def}
          action={rule.then}
          onChange={(action) => onChange({ ...rule, then: action })}
        />
      </div>
    </div>
  );
}
