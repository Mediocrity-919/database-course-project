import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import {
  DomainError,
  getNextQuestion,
  normalizeValue,
  orderedQuestions,
  replayPath,
  type Answer,
  type Definition,
  type Value,
} from "../../../../packages/shared/src/domain.js";
import { Button, ErrorBox } from "../ui.js";
import { QuestionInput } from "./QuestionInput.js";
import { prepareProgress } from "./progress.js";
import { ApiError } from "../api.js";
export function Runner({
  definition,
  initialAnswers = [],
  onSave,
  onSubmit,
  preview = false,
}: {
  definition: Definition;
  initialAnswers?: Answer[];
  onSave?: (a: Answer[]) => Promise<void>;
  onSubmit: (a: Answer[]) => Promise<void>;
  preview?: boolean;
}) {
  const first = orderedQuestions(definition)[0];
  const [answers, setAnswers] = useState<Answer[]>(initialAnswers),
    [history, setHistory] = useState<string[]>(first ? [first.id] : []),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pendingSubmission, setPendingSubmission] = useState<Answer[] | null>(null),
    [saveLabel, setSaveLabel] = useState(
      initialAnswers.length ? "已恢复保存的答案" : "",
    );
  const operation = useRef(false);
  if (!first) return <div className="empty-state">添加题目后即可预览。</div>;
  const q = definition.questions.find(
      (q) => q.id === history[history.length - 1],
    )!,
    value = answers.find((a) => a.questionId === q.id)?.value;
  const change = (value: Value | undefined) => {
    setAnswers((old) => [
      ...old.filter((a) => a.questionId !== q.id),
      ...(value === undefined ? [] : [{ questionId: q.id, value }]),
    ]);
    setError("");
    setSaveLabel("尚未保存");
  };
  const submit = async (payload: Answer[]) => {
    setPendingSubmission(payload);
    try {
      await onSubmit(payload);
      setPendingSubmission(null);
    } catch (error) {
      // A transport/server failure may happen after commit. Freeze the payload
      // and retry the same submission instead of issuing another draft save.
      if (!pendingSubmission && error instanceof ApiError && error.status < 500)
        setPendingSubmission(null);
      throw error;
    }
  };
  const move = async (back = false) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      if (pendingSubmission) {
        await submit(pendingSubmission);
        return;
      }
      let next: string | null = null;
      if (!back) {
        const current = normalizeValue(q, value);
        if (q.required && current === undefined)
          throw new DomainError("ANSWER_REQUIRED", "请完成当前必答题");
        next = getNextQuestion(definition, q, current);
      }
      const progress = prepareProgress(definition, answers);
      setAnswers(progress.retained);
      if (!back && !next) {
        // The submit transaction itself persists these answers atomically.
        const full = replayPath(definition, progress.answers, true);
        await submit(full.answers);
        return;
      }
      if (onSave) {
        setSaveLabel("正在保存…");
        await onSave(progress.answers);
        setSaveLabel(
          progress.hasUnsavedInput
            ? "有效答案已保存；未完成输入暂留页面，请修正后再刷新"
            : "已保存到服务器",
        );
      }
      setHistory((old) => (back ? old.slice(0, -1) : [...old, next!]));
    } catch (e) {
      setError((e as Error).message);
      setSaveLabel("请检查答案或重试保存");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const hint =
    q.type === "multiple_choice"
      ? `选择 ${q.validation.minSelections ?? 0}～${q.validation.maxSelections ?? q.options?.length} 项`
      : q.type === "number"
        ? `${q.validation.integerOnly ? "整数 · " : ""}${q.validation.min ?? "不限"}～${q.validation.max ?? "不限"}`
        : q.type === "text"
          ? `最多 ${q.validation.maxLength ?? 2000} 字符`
          : "请选择一项";
  return (
    <div className="runner">
      <div className="runner-meta">
        <span>
          {preview ? "预览模式 · 不保存答卷" : `已经过 ${history.length} 道题`}
        </span>
        <span>全卷 {definition.questions.length} 题，按答案跳转</span>
      </div>
      <div className="runner-progress">
        <div
          style={{
            width: `${Math.min(100, (history.length / definition.questions.length) * 100)}%`,
          }}
        />
      </div>
      <div className="question-label">
        QUESTION {String(q.order).padStart(2, "0")}
        <span>
          {q.required ? "必答" : "选答"} · {hint}
        </span>
      </div>
      <h2>{q.title}</h2>
      {q.description && <p className="muted">{q.description}</p>}
      <QuestionInput
        q={q}
        value={value}
        onChange={change}
        disabled={busy || !!pendingSubmission}
      />
      {pendingSubmission && !busy && (
        <p className="edit-notice" role="status">
          提交结果暂未确认，答案已保留。请重试提交，或刷新页面确认结果。
        </p>
      )}
      <ErrorBox message={error} />
      <div className="runner-actions">
        <Button
          variant="secondary"
          disabled={busy || !!pendingSubmission || history.length < 2}
          onClick={() => void move(true)}
        >
          <ArrowLeft size={16} />
          上一题
        </Button>
        <span className="save-label">{saveLabel}</span>
        <Button disabled={busy} onClick={() => void move()}>
          {busy
            ? "处理中…"
            : pendingSubmission
              ? "重试提交"
              : getNextQuestion(definition, q, value)
                ? "保存并继续"
                : preview
                  ? "完成预览"
                  : "确认提交"}
          {getNextQuestion(definition, q, value) ? (
            <ArrowRight size={16} />
          ) : (
            <Check size={16} />
          )}
        </Button>
      </div>
    </div>
  );
}
