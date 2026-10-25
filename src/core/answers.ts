import {
  SURVEY_LIMITS,
  SurveyAnswersSchema,
  SurveyIsoDateSchema,
  type SurveyAnswers,
  type SurveyDefinition,
  type SurveyIssue,
  type SurveyQuestion,
} from "./definition.js";
import { evaluateSurveyPath } from "./path.js";

function isEmpty(value: unknown): boolean {
  if (value === "" || (Array.isArray(value) && value.length === 0)) return true;
  // 矩阵/多项填空的「未作答」是空对象：一律按空答案处理，不进逐行校验。
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

// HH:mm 24 小时制；date 用 definition.ts 的 SurveyIsoDateSchema 同一口径。
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isoDate(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 矩阵/多项填空答案的形状守卫：只认自有属性（原型链上的同名键不算答案）。 */
function ownCell(
  value: unknown,
  subId: string,
): { ok: false } | { ok: true; cell: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { ok: false };
  const record = value as Record<string, unknown>;
  return Object.hasOwn(record, subId)
    ? { ok: true, cell: record[subId] }
    : { ok: false };
}

function checkValue(
  q: SurveyQuestion,
  value: unknown,
  path: string,
  issues: SurveyIssue[],
): void {
  const issue = (code: string, message: string): void => {
    issues.push({ path, code, message });
  };

  switch (q.type) {
    // 图片单选/多选的作答值域与 single/multiple 相同（选项 id / id 数组）。
    case "single":
    case "image_single": {
      if (typeof value !== "string")
        return issue("invalid_type", "单选题答案必须是选项 id 字符串");
      if (!q.options.some((o) => o.id === value))
        issue("invalid_option", "答案不是该题的有效选项");
      return;
    }
    case "multiple":
    case "image_multiple": {
      if (!Array.isArray(value))
        return issue("invalid_type", "多选题答案必须是选项 id 数组");
      const seen = new Set<string>();
      for (const [i, v] of value.entries()) {
        if (typeof v !== "string" || !q.options.some((o) => o.id === v)) {
          issues.push({
            path: `${path}.${i}`,
            code: "invalid_option",
            message: "答案不是该题的有效选项",
          });
        } else if (seen.has(v)) {
          issues.push({
            path: `${path}.${i}`,
            code: "duplicate_option",
            message: "多选答案含重复选项",
          });
        }
        seen.add(v);
      }
      const exclusivePicked = value.filter((v) =>
        q.options.some((o) => o.id === v && o.exclusive),
      );
      if (exclusivePicked.length > 0 && value.length > 1) {
        issue("exclusive_conflict", "互斥选项不能与其他选项同时选择");
      }
      if (q.minChoices !== undefined && value.length < q.minChoices)
        issue("too_few_choices", `至少选择 ${q.minChoices} 项`);
      if (q.maxChoices !== undefined && value.length > q.maxChoices)
        issue("too_many_choices", `最多选择 ${q.maxChoices} 项`);
      return;
    }
    case "text": {
      if (typeof value !== "string")
        return issue("invalid_type", "文本题答案必须是字符串");
      const max = q.maxLength ?? SURVEY_LIMITS.maxTextLength;
      if (value.length > max) issue("too_long", `文本超过上限 ${max} 字符`);
      return;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value))
        return issue("invalid_type", "数字题答案必须是有限数字");
      if (q.min !== undefined && value < q.min)
        issue("out_of_range", `答案小于下限 ${q.min}`);
      if (q.max !== undefined && value > q.max)
        issue("out_of_range", `答案大于上限 ${q.max}`);
      return;
    }
    case "scale": {
      if (typeof value !== "number" || !Number.isInteger(value))
        return issue("invalid_type", "量表题答案必须是整数");
      if (value < q.min || value > q.max)
        issue("out_of_range", `答案超出量程 ${q.min}–${q.max}`);
      return;
    }
    case "dropdown": {
      if (typeof value !== "string")
        return issue("invalid_type", "下拉题答案必须是选项 id 字符串");
      if (!q.options.some((o) => o.id === value))
        issue("invalid_option", "答案不是该题的有效选项");
      return;
    }
    case "rating": {
      if (typeof value !== "number" || !Number.isInteger(value))
        return issue("invalid_type", "评分题答案必须是整数档位");
      if (value < 1 || value > q.max)
        issue("out_of_range", `答案超出评分范围 1–${q.max}`);
      return;
    }
    case "nps": {
      if (typeof value !== "number" || !Number.isInteger(value))
        return issue("invalid_type", "NPS 答案必须是 0–10 整数");
      if (value < 0 || value > 10) issue("out_of_range", "答案超出 NPS 范围 0–10");
      return;
    }
    case "date": {
      if (typeof value !== "string" || !SurveyIsoDateSchema.safeParse(value).success)
        return issue("invalid_type", "日期答案必须是 YYYY-MM-DD 格式");
      const parsed = isoDate(value)!;
      if (q.min !== undefined && parsed < isoDate(q.min)!)
        issue("out_of_range", `答案早于下限 ${q.min}`);
      if (q.max !== undefined && parsed > isoDate(q.max)!)
        issue("out_of_range", `答案晚于上限 ${q.max}`);
      return;
    }
    case "time": {
      if (typeof value !== "string" || !TIME_RE.test(value))
        return issue("invalid_type", "时间答案必须是 HH:mm 格式");
      return;
    }
    case "ranking": {
      if (!Array.isArray(value))
        return issue("invalid_type", "排序题答案必须是选项 id 数组");
      const seen = new Set<string>();
      for (const [i, v] of value.entries()) {
        if (typeof v !== "string" || !q.options.some((o) => o.id === v)) {
          issues.push({
            path: `${path}.${i}`,
            code: "invalid_option",
            message: "答案不是该题的有效选项",
          });
        } else if (seen.has(v)) {
          issues.push({
            path: `${path}.${i}`,
            code: "duplicate_option",
            message: "排序答案含重复选项",
          });
        }
        seen.add(v);
      }
      if (value.length !== q.options.length)
        issue("ranking_incomplete", "排序题需要对全部选项排出名次");
      return;
    }
    case "matrix_single":
    case "matrix_multiple": {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return issue("invalid_type", "矩阵题答案必须是行到列的映射对象");
      const required = q.required;
      for (const row of q.rows) {
        const cell = ownCell(value, row.id);
        if (!cell.ok || cell.cell === undefined) {
          if (required)
            issues.push({
              path: `${path}.${row.id}`,
              code: "required_missing",
              message: "矩阵必答题有行未作答",
            });
          continue;
        }
        const picked = cell.cell;
        if (q.type === "matrix_single") {
          if (typeof picked !== "string" || !q.columns.some((c) => c.id === picked)) {
            issues.push({
              path: `${path}.${row.id}`,
              code: "invalid_column",
              message: "答案不是该行的有效列",
            });
          }
          continue;
        }
        if (!Array.isArray(picked)) {
          issues.push({
            path: `${path}.${row.id}`,
            code: "invalid_column",
            message: "矩阵多选的行答案必须是列 id 数组",
          });
          continue;
        }
        const seen = new Set<string>();
        for (const [i, v] of picked.entries()) {
          if (typeof v !== "string" || !q.columns.some((c) => c.id === v)) {
            issues.push({
              path: `${path}.${row.id}.${i}`,
              code: "invalid_column",
              message: "答案不是该行的有效列",
            });
          } else if (seen.has(v)) {
            issues.push({
              path: `${path}.${row.id}.${i}`,
              code: "duplicate_option",
              message: "同一行的多选含重复列",
            });
          }
          seen.add(v);
        }
      }
      // 子键必须全部是定义内的行 id：多余行是脏答案，不是「多答了」。
      for (const key of Object.keys(value as object)) {
        if (!q.rows.some((row) => row.id === key)) {
          issues.push({
            path: `${path}.${key}`,
            code: "invalid_row",
            message: "答案指向不存在的矩阵行",
          });
        }
      }
      return;
    }
    // 矩阵填空：值是行到文本的映射；必答口径 = 全行非空（空串按未作答）。
    case "matrix_text": {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return issue("invalid_type", "矩阵填空答案必须是行到文本的映射对象");
      for (const row of q.rows) {
        const cell = ownCell(value, row.id);
        if (!cell.ok || cell.cell === undefined || cell.cell === "") {
          if (q.required)
            issues.push({
              path: `${path}.${row.id}`,
              code: "required_missing",
              message: "矩阵填空必答题有行未作答",
            });
          continue;
        }
        if (typeof cell.cell !== "string") {
          issues.push({
            path: `${path}.${row.id}`,
            code: "invalid_type",
            message: "矩阵填空的行答案必须是字符串",
          });
        }
      }
      for (const key of Object.keys(value as object)) {
        if (!q.rows.some((row) => row.id === key)) {
          issues.push({
            path: `${path}.${key}`,
            code: "invalid_row",
            message: "答案指向不存在的矩阵行",
          });
        }
      }
      return;
    }
    case "multi_text": {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return issue("invalid_type", "多项填空答案必须是项到文本的映射对象");
      for (const item of q.items) {
        const entry = ownCell(value, item.id);
        if (!entry.ok || entry.cell === undefined) {
          if (q.required)
            issues.push({
              path: `${path}.${item.id}`,
              code: "required_missing",
              message: "多项填空必答题有项未填写",
            });
          continue;
        }
        if (typeof entry.cell !== "string") {
          issues.push({
            path: `${path}.${item.id}`,
            code: "invalid_type",
            message: "填空项答案必须是字符串",
          });
        }
      }
      for (const key of Object.keys(value as object)) {
        if (!q.items.some((item) => item.id === key)) {
          issues.push({
            path: `${path}.${key}`,
            code: "invalid_item",
            message: "答案指向不存在的填空项",
          });
        }
      }
      return;
    }
    case "statement": {
      issue("statement_answer", "说明块不收集答案");
      return;
    }
  }
}

// 必答缺失（整题缺席或空对象）的 issue 口径：矩阵/多项填空按行/项逐条发
// required_missing（path 带 rowId/itemId），与部分作答的口径一致——作答页
// 拦截语要靠它指名漏答的行/项。
function missingRequiredIssues(
  q: SurveyQuestion,
  qid: string,
  issues: SurveyIssue[],
): void {
  if (
    q.type === "matrix_single" ||
    q.type === "matrix_multiple" ||
    q.type === "matrix_text" ||
    q.type === "multi_text"
  )
    checkValue(q, {}, qid, issues);
  else
    issues.push({ path: qid, code: "required_missing", message: "必答题未作答" });
}

/**
 * 提交口径：整卷按最终答案重算路径，任何落在不可见题上的答案都是操纵路径的尝试——拒绝，
 * 不静默清洗（清洗只发生在前端 pruneSurveyAnswers）。
 */
export function validateSurveyAnswers(
  def: SurveyDefinition,
  answers: unknown,
): SurveyIssue[] {
  const parsed = SurveyAnswersSchema.safeParse(answers);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      code: `schema.${i.code}`,
      message: i.message,
    }));
  }
  const data = parsed.data;
  const issues: SurveyIssue[] = [];
  const questionById = new Map(def.questions.map((q) => [q.id, q]));
  // Zod 会丢弃 __proto__ 键；未知题检查必须覆盖解析前的自有键。
  for (const qid of Object.keys(answers as object)) {
    if (!questionById.has(qid))
      issues.push({
        path: qid,
        code: "unknown_question",
        message: `答案指向不存在的题目：${qid}`,
      });
  }
  const visible = new Set(evaluateSurveyPath(def, data).questionIds);

  for (const [qid, value] of Object.entries(data)) {
    const q = questionById.get(qid);
    if (!q) continue;
    if (!visible.has(qid)) {
      issues.push({
        path: qid,
        code: "hidden_answer",
        message: "答案指向当前路径下不可见的题目",
      });
      continue;
    }
    if (isEmpty(value)) {
      // 空值按约定应省略 key；必答题视为未答，其余提示调用方修正。
      if (q.required) missingRequiredIssues(q, qid, issues);
      else
        issues.push({
          path: qid,
          code: "empty_answer",
          message: "空答案应省略该 key",
        });
      continue;
    }
    checkValue(q, value, qid, issues);
  }

  for (const qid of visible) {
    const q = questionById.get(qid);
    if (q?.required && data[qid] === undefined)
      missingRequiredIssues(q, qid, issues);
  }
  return issues;
}

/**
 * 前端专用：路径变化后清掉失效答案。只删「不可见 / 不存在」的 key，不修正任何值——
 * 类型或值域错误原样保留，由服务端 validateSurveyAnswers 拒绝。
 */
export function pruneSurveyAnswers(
  def: SurveyDefinition,
  answers: SurveyAnswers,
): SurveyAnswers {
  const visible = new Set(evaluateSurveyPath(def, answers).questionIds);
  const out: SurveyAnswers = {};
  for (const [qid, value] of Object.entries(answers)) {
    if (visible.has(qid)) out[qid] = value;
  }
  return out;
}
