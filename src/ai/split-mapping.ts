import type { SurveyReviewFinding } from "../contracts/index.js";
import { applySurveyOps, type SurveyDefinition } from "../core/index.js";

export function connectSplitQuestions(finding: SurveyReviewFinding, definition: SurveyDefinition): void {
  if (finding.checkId !== "wording.double_barrel" || !finding.questionId || !finding.suggestedOps?.length || !definition.researchDesign) return;
  const anchorId = finding.questionId;
  const constructs = definition.researchDesign.constructs.filter((item) => item.questionIds.includes(anchorId));
  const page = definition.pages.find((item) => item.questionIds.includes(anchorId));
  if (constructs.length !== 1 || !page) return;
  const originalOps = finding.suggestedOps;
  if (originalOps.some((op) => {
    if (op.op === "set_meta") return !op.researchDesign;
    if (op.op === "add_question") return op.pageId !== page.id;
    if (op.op === "update_question" || op.op === "remove_question") return op.questionId !== anchorId;
    return true;
  })) return;
  const removesAnchor = originalOps.some((op) => op.op === "remove_question" && op.questionId === anchorId);
  let insertAt = page.questionIds.indexOf(anchorId) + (removesAnchor ? 0 : 1);
  const withoutMeta = originalOps.filter((op) => op.op !== "set_meta").map((op) => {
    if (op.op !== "add_question") return op;
    const index = op.index ?? insertAt;
    insertAt = index + 1;
    return { ...op, index };
  });
  const result = applySurveyOps(definition, withoutMeta);
  if (result.rejected.length) return;
  const beforeIds = new Set(definition.questions.map((item) => item.id));
  const newIds = result.definition.questions.filter((item) => item.type !== "statement" && !beforeIds.has(item.id)).map((item) => item.id);
  if (!newIds.length) return;
  const retained = result.definition.questions.some((item) => item.id === anchorId);
  const design = {
    ...definition.researchDesign,
    constructs: definition.researchDesign.constructs.map((item) => item.id !== constructs[0]!.id ? item : {
      ...item, questionIds: [...item.questionIds.filter((id) => id !== anchorId || retained), ...newIds],
    }),
  };
  finding.suggestedOps = [...result.applied, { op: "set_meta", researchDesign: design }];
  finding.recommendation = "拆成两题，并同步更新各题的研究用途。";
}
