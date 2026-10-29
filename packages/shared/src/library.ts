import {
  emptyDefinition,
  validateDefinition,
  type Question,
} from "./domain.js";

// Survey navigation is contextual; it is never stored as part of a reusable item.
export function libraryContent(input: unknown): Question {
  const raw = input && typeof input === "object" ? input : {};
  const q = validateDefinition(
    {
      ...emptyDefinition(),
      questions: [
        {
          ...raw,
          order: 1,
          logic: {
            matchMode: "first_match",
            rules: [],
            defaultAction: { action: "next" },
          },
        },
      ],
    },
    true,
  ).questions[0];
  const { source: _source, ...content } = q;
  return {
    ...content,
    order: 1,
    logic: {
      matchMode: "first_match",
      rules: [],
      defaultAction: { action: "next" },
    },
  };
}
export function questionCore(q: Question) {
  return {
    type: q.type,
    title: q.title,
    description: q.description ?? "",
    required: q.required,
    options: [...(q.options ?? [])].sort((a, b) => a.order - b.order),
    validation: q.validation,
  };
}
export function sameCore(a: Question, b: Question) {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return (
    JSON.stringify(canonical(questionCore(a))) ===
    JSON.stringify(canonical(questionCore(b)))
  );
}
