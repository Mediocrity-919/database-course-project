import {
  textAnswerLength,
  type Question,
  type Value,
} from "../../../../packages/shared/src/domain.js";
export function QuestionInput({
  q,
  value,
  onChange,
  disabled = false,
}: {
  q: Question;
  value: Value | undefined;
  onChange: (v: Value | undefined) => void;
  disabled?: boolean;
}) {
  if (q.type === "single_choice" || q.type === "multiple_choice")
    return (
      <div className="answer-options">
        {q.options?.map((o) => {
          const checked =
            q.type === "single_choice"
              ? value === o.id
              : Array.isArray(value) && value.includes(o.id);
          return (
            <label
              className={`answer-option ${checked ? "checked" : ""}`}
              key={o.id}
            >
              <input
                type={q.type === "single_choice" ? "radio" : "checkbox"}
                name={q.id}
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  if (q.type === "single_choice") onChange(o.id);
                  else {
                    const before = Array.isArray(value) ? value : [];
                    onChange(
                      checked
                        ? before.filter((x) => x !== o.id)
                        : [...before, o.id],
                    );
                  }
                }}
              />
              <span>{o.label}</span>
            </label>
          );
        })}
        {!q.required && (
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => onChange(undefined)}
          >
            清空选择
          </button>
        )}
      </div>
    );
  if (q.type === "number")
    return (
      <input
        className="number-answer"
        aria-label={q.title}
        type="number"
        disabled={disabled}
        inputMode={q.validation.integerOnly ? "numeric" : "decimal"}
        step={q.validation.integerOnly ? 1 : "any"}
        value={(value as number) ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : e.target.valueAsNumber)
        }
        placeholder="请输入数字"
      />
    );
  return (
    <>
      <textarea
        className="text-answer"
        disabled={disabled}
        aria-label={q.title}
        aria-describedby={`${q.id}-length`}
        rows={5}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder="写下你的回答…"
      />
      <p className="muted" id={`${q.id}-length`}>
        已填写 {textAnswerLength(typeof value === "string" ? value : "")} /{" "}
        {q.validation.maxLength ?? 2000} 个字符（不计首尾空白）
      </p>
    </>
  );
}
