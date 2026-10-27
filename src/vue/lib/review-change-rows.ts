// 诊断候选改动的 before/after 行投影（issue #224 M2）：原研究面板 changeRows
// 的提炼，消费方是题旁建议气泡的候选项核对区。只列真实差异：同值异序（如
// showIf 字段顺序）不算修改；增删题显示标题行；researchDesign 走字段标签
// 映射。t 由调用方注入，保持纯函数可测。
import type { SurveyDefinition, SurveyReviewPlanGroup } from "../../core/index.js";
import type { SurveyReviewFinding } from "../../contracts/index.js";

export interface ReviewChangeRow {
  key: string;
  questionId?: string;
  /** 定位按钮文案：题号 · 字段（meta 行没有题号，不产按钮）。 */
  location?: string;
  field: string;
  before: string;
  after: string;
}

export interface ReviewChangeContext {
  original: SurveyDefinition;
  /** blocked/manual-only 时无候选；行投影只在有候选时被调用。 */
  candidate: SurveyDefinition | null;
  findings: SurveyReviewFinding[];
  t: (key: string, params?: Record<string, unknown>) => string;
}

const fieldLabelKeys: Record<string, string> = {
  title: "surveys.questionTitle",
  type: "surveys.questionType",
  required: "surveys.required",
  options: "surveys.assistant.options",
  showIf: "surveys.showCondition",
  min: "surveys.minimum",
  max: "surveys.maximum",
  minLabel: "surveys.scaleMinLabel",
  maxLabel: "surveys.scaleMaxLabel",
  rows: "surveys.matrixRows",
  columns: "surveys.matrixColumns",
};
const designFieldLabelKeys: Record<string, string> = {
  researchQuestion: "surveys.assistant.question",
  population: "surveys.assistant.population",
  recruitment: "surveys.assistant.recruitment",
  analysisPlan: "surveys.assistant.analysis",
  assumptions: "surveys.assistant.assumptions",
  pendingDecisions: "surveys.assistant.pending",
};

export function reviewQuestionLabel(id: string, ctx: ReviewChangeContext): string {
  const originalIndex = ctx.original.questions.findIndex((question) => question.id === id);
  const candidateIndex = ctx.candidate?.questions.findIndex((question) => question.id === id) ?? -1;
  const resolved = originalIndex >= 0 ? originalIndex : candidateIndex;
  return resolved < 0 ? ctx.t("surveys.assistant.unmapped") : ctx.t("surveys.assistant.questionIndex", { n: resolved + 1 });
}

function conditionValue(ctx: ReviewChangeContext, questionId: string, value: unknown) {
  const source = ctx.original.questions.find((question) => question.id === questionId);
  const options = source && "options" in source ? source.options : undefined;
  const option = options?.find((item) => item.id === String(value));
  return formatValue(ctx, option?.label ?? value);
}

function formatValue(ctx: ReviewChangeContext, value: unknown): string {
  const { t } = ctx;
  if (value === undefined || value === null || value === "") return t("surveys.assistant.unchangedValue");
  if (typeof value === "boolean") return t(value ? "surveys.assistant.yes" : "surveys.assistant.no");
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((item) => formatValue(ctx, item)).join("、");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.label === "string") return record.label;
    if (typeof record.questionId === "string") {
      return t("surveys.assistant.conditionSummary", {
        question: reviewQuestionLabel(record.questionId, ctx), value: conditionValue(ctx, record.questionId, record.value),
      });
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])];
  return keys.every((key) => sameValue(leftRecord[key], rightRecord[key]));
}

function groupQuestionIds(ctx: ReviewChangeContext, group: SurveyReviewPlanGroup) {
  const byId = new Map(ctx.findings.map((finding) => [finding.id, finding]));
  return [...new Set(group.findingIds.flatMap((id) => {
    const questionId = byId.get(id)?.questionId;
    return questionId ? [questionId] : [];
  }))];
}

export function reviewChangeRows(group: SurveyReviewPlanGroup, ctx: ReviewChangeContext): ReviewChangeRow[] {
  const { original, candidate, t } = ctx;
  if (!candidate) return [];
  const ids = new Set<string>(groupQuestionIds(ctx, group));
  for (const op of group.ops) {
    if ("questionId" in op) ids.add(op.questionId);
    if (op.op === "add_question" && typeof op.question.id === "string") ids.add(op.question.id);
  }
  const questionRows: ReviewChangeRow[] = [...ids].flatMap((id) => {
    const before = original.questions.find((question) => question.id === id) as Record<string, unknown> | undefined;
    const after = candidate.questions.find((question) => question.id === id) as Record<string, unknown> | undefined;
    if (!before || !after) {
      const question = before ?? after;
      return [{ key: id, questionId: id, location: reviewQuestionLabel(id, ctx), field: t("surveys.questionTitle"),
        before: before ? formatValue(ctx, question?.title) : t("surveys.assistant.unchangedValue"),
        after: after ? formatValue(ctx, question?.title) : t("surveys.assistant.unchangedValue") }];
    }
    const rows: ReviewChangeRow[] = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((field) => field !== "id" && !sameValue(before[field], after[field]))
      .map((field) => ({
        key: `${id}:${field}`, questionId: id, location: `${reviewQuestionLabel(id, ctx)} · ${t(fieldLabelKeys[field] ? fieldLabelKeys[field]! : field)}`,
        field: fieldLabelKeys[field] ? t(fieldLabelKeys[field]!) : field,
        before: formatValue(ctx, before[field]), after: formatValue(ctx, after[field]),
      }));
    const beforeIndex = original.questions.findIndex((question) => question.id === id);
    const afterIndex = candidate.questions.findIndex((question) => question.id === id);
    if (beforeIndex !== afterIndex) rows.push({
      key: `${id}:position`, questionId: id, location: `${reviewQuestionLabel(id, ctx)} · ${t("surveys.assistant.position")}`,
      field: t("surveys.assistant.position"),
      before: String(beforeIndex + 1), after: String(afterIndex + 1),
    });
    return rows;
  });
  const metaRows: ReviewChangeRow[] = group.ops.flatMap((op) => {
    if (op.op !== "set_meta") return [];
    const rows: ReviewChangeRow[] = [];
    for (const [field, labelKey] of [["title", "surveys.title"], ["description", "surveys.description"], ["consent", "surveys.consent"]] as const) {
      if (op[field] !== undefined && !sameValue(original[field], candidate[field])) rows.push({
        key: `meta:${field}`, field: t(labelKey), before: formatValue(ctx, original[field]), after: formatValue(ctx, candidate[field]),
      });
    }
    if (op.researchDesign !== undefined) {
      const before = (original.researchDesign ?? {}) as Record<string, unknown>;
      const after = (candidate.researchDesign ?? {}) as Record<string, unknown>;
      const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((field) => !sameValue(before[field], after[field]));
      rows.push(...fields.map((field) => ({
        key: `meta:researchDesign.${field}`,
        field: designFieldLabelKeys[field] ? t(designFieldLabelKeys[field]!) : t("surveys.assistant.design"),
        before: formatValue(ctx, before[field]), after: formatValue(ctx, after[field]),
      })));
    }
    return rows;
  });
  return [...questionRows, ...metaRows];
}
