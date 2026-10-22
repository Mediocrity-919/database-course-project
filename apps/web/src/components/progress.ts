import {
  DomainError,
  getNextQuestion,
  normalizeValue,
  orderedQuestions,
  type Answer,
  type Definition,
} from "../../../../packages/shared/src/domain.js";

// Save only the valid reachable prefix. Keep unfinished input in the form so
// moving backwards never makes a later validation error block forward navigation.
export function prepareProgress(definition: Definition, input: Answer[]) {
  const questions = orderedQuestions(definition);
  const byId = new Map(input.map((a) => [a.questionId, a]));
  const answers: Answer[] = [];
  let id: string | null = questions[0]?.id ?? null;
  const visited = new Set<string>();
  while (id) {
    if (visited.has(id)) throw new DomainError("LOGIC_CYCLE", "跳转出现循环");
    visited.add(id);
    const q = questions.find((q) => q.id === id)!;
    const raw = byId.get(id);
    let value;
    let invalid = false;
    try {
      value = normalizeValue(q, raw?.value);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      invalid = true;
    }
    if (invalid || (q.required && value === undefined)) {
      const unfinished = input.filter((a) =>
        questions.some((t) => t.id === a.questionId && t.order >= q.order),
      );
      return {
        answers,
        retained: [...answers, ...unfinished],
        hasUnsavedInput: unfinished.length > 0,
      };
    }
    if (value !== undefined)
      answers.push({ questionId: q.id, questionType: q.type, value });
    id = getNextQuestion(definition, q, value);
  }
  return { answers, retained: answers, hasUnsavedInput: false };
}
