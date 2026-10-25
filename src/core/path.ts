import type {
  SurveyAnswers,
  SurveyCondition,
  SurveyDefinition,
  SurveyQuestion,
} from "./definition.js";

// 条件求值只认「可见且已过 schema 形状」的答案；隐藏题/非法类型的答案一律视为不满足，
// 否则一个被隐藏的多选数组答案就能偷偷打开分支。
export function evalSurveyCondition(
  cond: SurveyCondition,
  visibleAnswers: SurveyAnswers,
): boolean {
  const ans = visibleAnswers[cond.questionId];
  if (ans === undefined) return false;
  if (cond.op === "eq") return ans === cond.value;
  return (
    Array.isArray(ans) &&
    typeof cond.value === "string" &&
    ans.includes(cond.value)
  );
}

/**
 * 按完整最终答案重算可达页与可见题。只读可见前题的答案推进，无网络、无随机。
 * 跳转只向后（validateSurveyDefinition 保证），visited 仅作防御兜底。
 */
export function evaluateSurveyPath(
  def: SurveyDefinition,
  answers: SurveyAnswers,
): { pageIds: string[]; questionIds: string[] } {
  const questionById = new Map<string, SurveyQuestion>(
    def.questions.map((q) => [q.id, q]),
  );
  const pageIndexById = new Map<string, number>(
    def.pages.map((p, i) => [p.id, i]),
  );
  const visibleAnswers: SurveyAnswers = {};
  const pageIds: string[] = [];
  const questionIds: string[] = [];
  const visited = new Set<number>();
  let idx = 0;
  while (idx >= 0 && idx < def.pages.length && !visited.has(idx)) {
    visited.add(idx);
    const page = def.pages[idx];
    pageIds.push(page.id);
    for (const qid of page.questionIds) {
      const q = questionById.get(qid);
      if (!q) continue;
      if (q.showIf && !evalSurveyCondition(q.showIf, visibleAnswers)) continue;
      questionIds.push(qid);
      const ans = answers[qid];
      if (ans !== undefined) visibleAnswers[qid] = ans;
    }
    let next = idx + 1;
    if (page.jump && evalSurveyCondition(page.jump.when, visibleAnswers)) {
      const target = pageIndexById.get(page.jump.targetPageId);
      if (target !== undefined && target > idx) next = target;
    }
    idx = next;
  }
  return { pageIds, questionIds };
}
