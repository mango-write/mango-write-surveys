import {
  SurveyDefinitionSchema,
  type SurveyCondition,
  type SurveyDefinition,
  type SurveyIssue,
  type SurveyQuestion,
} from "./definition.js";
import { surveyVariables } from "./variables.js";

function schemaIssues(error: import("zod").ZodError): SurveyIssue[] {
  return error.issues.map((i) => ({
    path: i.path.join("."),
    code: `schema.${i.code}`,
    message: i.message,
  }));
}

// 条件合法性与题型的绑定：单值题只 eq（多选 contains），矩阵/排序/多项填空/
// 说明块没有可比的单值，不能作为条件源；引用选项题的 value 必须是其真实选项 id，
// 否则该分支永远不可达（配置错误）。
function checkCondition(
  cond: SurveyCondition,
  target: SurveyQuestion,
  path: string,
  issues: SurveyIssue[],
): void {
  const mismatch = (message: string): void => {
    issues.push({ path, code: "condition_type_mismatch", message });
  };
  const unknownOption = (options: { id: string }[]): void => {
    if (!options.some((o) => o.id === cond.value)) {
      issues.push({
        path: `${path}.value`,
        code: "condition_unknown_option",
        message: "条件引用了不存在的选项",
      });
    }
  };
  switch (target.type) {
    // 图片单选/多选与 single/multiple 的条件算子同集（作答值域相同）。
    case "single":
    case "dropdown":
    case "image_single":
      if (cond.op !== "eq" || typeof cond.value !== "string")
        return mismatch("单选题条件只支持 eq 且值为选项 id");
      return unknownOption(target.options);
    case "multiple":
    case "image_multiple":
      if (cond.op !== "contains" || typeof cond.value !== "string")
        return mismatch("多选题条件只支持 contains 且值为选项 id");
      return unknownOption(target.options);
    case "number":
      if (cond.op !== "eq" || typeof cond.value !== "number")
        return mismatch("数字题条件只支持 eq 且值为数字");
      return;
    case "scale":
      if (
        cond.op !== "eq" ||
        typeof cond.value !== "number" ||
        !Number.isInteger(cond.value)
      ) {
        return mismatch("量表题条件只支持 eq 且值为量程内整数");
      }
      if (cond.value < target.min || cond.value > target.max)
        return mismatch("量表题条件值超出量程");
      return;
    case "rating":
      if (
        cond.op !== "eq" ||
        typeof cond.value !== "number" ||
        !Number.isInteger(cond.value)
      ) {
        return mismatch("评分题条件只支持 eq 且值为档位内整数");
      }
      if (cond.value < 1 || cond.value > target.max)
        return mismatch("评分题条件值超出档位范围");
      return;
    case "nps":
      if (
        cond.op !== "eq" ||
        typeof cond.value !== "number" ||
        !Number.isInteger(cond.value)
      ) {
        return mismatch("NPS 题条件只支持 eq 且值为 0–10 整数");
      }
      if (cond.value < 0 || cond.value > 10)
        return mismatch("NPS 题条件值超出 0–10");
      return;
    case "date":
      if (cond.op !== "eq" || typeof cond.value !== "string")
        return mismatch("日期题条件只支持 eq 且值为 YYYY-MM-DD 字符串");
      return;
    case "time":
      if (cond.op !== "eq" || typeof cond.value !== "string")
        return mismatch("时间题条件只支持 eq 且值为 HH:mm 字符串");
      return;
    case "text":
      if (cond.op !== "eq" || typeof cond.value !== "string")
        return mismatch("文本题条件只支持 eq 且值为字符串");
      return;
    default:
      issues.push({
        path,
        code: "condition_unsupported_source",
        message: "该题型不能作为显示/跳转条件的来源",
      });
  }
}

/**
 * 语义校验：schema 形状之外的定义级约束（唯一性、归属、引用方向、范围）。
 * 形状错误先整体返回；「发布至少 1 题 1 页」由服务层在发布时检查，草稿允许空壳。
 */
export function validateSurveyDefinition(def: unknown): SurveyIssue[] {
  const parsed = SurveyDefinitionSchema.safeParse(def);
  if (!parsed.success) return schemaIssues(parsed.error);
  const d: SurveyDefinition = parsed.data;
  const issues: SurveyIssue[] = [];
  const issue = (path: string, code: string, message: string): void => {
    issues.push({ path, code, message });
  };

  const questionById = new Map<string, SurveyQuestion>();
  d.questions.forEach((q, i) => {
    if (questionById.has(q.id))
      issue(`questions.${i}.id`, "duplicate_id", `题目 id 重复：${q.id}`);
    questionById.set(q.id, q);
    if (
      (q.type === "single" ||
        q.type === "multiple" ||
        q.type === "image_single" ||
        q.type === "image_multiple" ||
        q.type === "dropdown") &&
      q.options.length === 0
    ) {
      issue(
        `questions.${i}.options`,
        "empty_options",
        "选择题至少需要一个选项",
      );
    }
    if (q.type === "ranking" && q.options.length < 2) {
      issue(
        `questions.${i}.options`,
        "empty_options",
        "排序题至少需要两个选项",
      );
    }
    if (
      q.type === "single" ||
      q.type === "multiple" ||
      q.type === "image_single" ||
      q.type === "image_multiple" ||
      q.type === "dropdown" ||
      q.type === "ranking"
    ) {
      const seen = new Set<string>();
      q.options.forEach((o, j) => {
        if (seen.has(o.id))
          issue(
            `questions.${i}.options.${j}.id`,
            "duplicate_id",
            `选项 id 重复：${o.id}`,
          );
        seen.add(o.id);
      });
    }
    if (
      q.type === "matrix_single" ||
      q.type === "matrix_multiple" ||
      q.type === "matrix_text"
    ) {
      const seenRows = new Set<string>();
      q.rows.forEach((row, j) => {
        if (seenRows.has(row.id))
          issue(
            `questions.${i}.rows.${j}.id`,
            "duplicate_id",
            `行 id 重复：${row.id}`,
          );
        seenRows.add(row.id);
      });
    }
    if (q.type === "matrix_single" || q.type === "matrix_multiple") {
      const seenColumns = new Set<string>();
      q.columns.forEach((column, j) => {
        if (seenColumns.has(column.id))
          issue(
            `questions.${i}.columns.${j}.id`,
            "duplicate_id",
            `列 id 重复：${column.id}`,
          );
        seenColumns.add(column.id);
      });
    }
    if (q.type === "multi_text") {
      const seen = new Set<string>();
      q.items.forEach((item, j) => {
        if (seen.has(item.id))
          issue(
            `questions.${i}.items.${j}.id`,
            "duplicate_id",
            `填空项 id 重复：${item.id}`,
          );
        seen.add(item.id);
      });
    }
    if (q.type === "statement" && q.required) {
      issue(
        `questions.${i}.required`,
        "statement_not_required",
        "说明块不是题目，不能设为必答",
      );
    }
    if (
      q.type === "date" &&
      q.min !== undefined &&
      q.max !== undefined &&
      q.min > q.max
    ) {
      issue(`questions.${i}.min`, "invalid_date_range", "日期下限不能晚于上限");
    }
    if (
      (q.type === "multiple" || q.type === "image_multiple") &&
      q.minChoices !== undefined &&
      q.maxChoices !== undefined &&
      q.minChoices > q.maxChoices
    ) {
      issue(
        `questions.${i}.minChoices`,
        "invalid_choice_range",
        "minChoices 不能大于 maxChoices",
      );
    }
    if (
      (q.type === "multiple" || q.type === "image_multiple") &&
      q.maxChoices !== undefined &&
      q.maxChoices > q.options.length
    ) {
      issue(
        `questions.${i}.maxChoices`,
        "invalid_choice_range",
        "maxChoices 超过选项数",
      );
    }
    if (
      q.type === "number" &&
      q.min !== undefined &&
      q.max !== undefined &&
      q.min > q.max
    ) {
      issue(`questions.${i}.min`, "invalid_number_range", "min 不能大于 max");
    }
    if (q.type === "scale") {
      if (q.min >= q.max)
        issue(
          `questions.${i}.min`,
          "invalid_scale_range",
          "量表 min 必须小于 max",
        );
      else if (q.max - q.min > 10)
        issue(
          `questions.${i}.max`,
          "invalid_scale_range",
          "量表跨度不能超过 10",
        );
    }
  });

  const pageIndexById = new Map<string, number>();
  d.pages.forEach((p, i) => {
    if (pageIndexById.has(p.id))
      issue(`pages.${i}.id`, "duplicate_id", `页 id 重复：${p.id}`);
    pageIndexById.set(p.id, i);
    if (p.questionIds.length === 0)
      issue(`pages.${i}.questionIds`, "empty_page", "页至少包含一道题");
  });

  // 每题恰属一页：先建归属表，再按页序展开得到全卷题目序号（「前题」的唯一口径）。
  const pageOfQuestion = new Map<string, number[]>();
  d.pages.forEach((p, pi) => {
    p.questionIds.forEach((qid, qi) => {
      if (!questionById.has(qid))
        issue(
          `pages.${pi}.questionIds.${qi}`,
          "unknown_question",
          `页引用了不存在的题目：${qid}`,
        );
      const list = pageOfQuestion.get(qid) ?? [];
      list.push(pi);
      pageOfQuestion.set(qid, list);
    });
  });
  for (const [qid, pages] of pageOfQuestion) {
    if (pages.length > 1) {
      const q = questionById.get(qid);
      if (q)
        issue(
          `questions.${d.questions.indexOf(q)}.id`,
          "question_in_multiple_pages",
          `题目 ${qid} 出现在多个页`,
        );
    }
  }
  d.questions.forEach((q, i) => {
    if (!pageOfQuestion.has(q.id))
      issue(
        `questions.${i}.id`,
        "orphan_question",
        `题目 ${q.id} 不属于任何页`,
      );
  });

  const orderIndex = new Map<string, number>();
  let order = 0;
  for (const p of d.pages)
    for (const qid of p.questionIds) orderIndex.set(qid, order++);

  const resolveCondTarget = (
    cond: SurveyCondition,
    path: string,
    boundary: number,
  ): void => {
    const target = questionById.get(cond.questionId);
    if (!target) {
      issue(
        `${path}.questionId`,
        "unknown_question",
        `条件引用了不存在的题目：${cond.questionId}`,
      );
      return;
    }
    const targetOrder = orderIndex.get(cond.questionId);
    if (targetOrder === undefined || targetOrder >= boundary) {
      issue(
        `${path}.questionId`,
        "condition_not_previous",
        "条件只能引用排在前面的题",
      );
      return;
    }
    checkCondition(cond, target, path, issues);
  };

  d.questions.forEach((q, i) => {
    if (!q.showIf) return;
    const boundary = orderIndex.get(q.id);
    if (boundary === undefined) return; // orphan 已报过
    resolveCondTarget(q.showIf, `questions.${i}.showIf`, boundary);
  });
  d.pages.forEach((p, i) => {
    if (!p.jump) return;
    const target = pageIndexById.get(p.jump.targetPageId);
    if (target === undefined)
      issue(
        `pages.${i}.jump.targetPageId`,
        "unknown_page",
        `跳页目标不存在：${p.jump.targetPageId}`,
      );
    else if (target <= i)
      issue(`pages.${i}.jump.targetPageId`, "jump_not_forward", "跳页只能向后");
    // 跳页条件在整页答完后求值：同页题也算「前题」，boundary 取下一页首题序号。
    const boundary =
      orderIndex.get(d.pages[i + 1]?.questionIds[0] ?? "") ?? order;
    resolveCondTarget(p.jump.when, `pages.${i}.jump.when`, boundary);
  });

  return issues;
}

// 题目映射仅产生方法学提示，发布硬门禁仍由 validateSurveyDefinition 拥有。
export function validateSurveyDesign(
  definition: SurveyDefinition,
): SurveyIssue[] {
  const design = definition.researchDesign;
  if (!design) return [];
  const issues: SurveyIssue[] = [];
  const questionIds = new Set(definition.questions.map((question) => question.id));
  const constructIds = new Set<string>();
  design.constructs.forEach((construct, i) => {
    if (constructIds.has(construct.id))
      issues.push({
        path: `researchDesign.constructs.${i}.id`,
        code: "duplicate_id",
        message: `维度 id 重复：${construct.id}`,
      });
    constructIds.add(construct.id);
    construct.questionIds.forEach((questionId, j) => {
      if (!questionIds.has(questionId))
        issues.push({
          path: `researchDesign.constructs.${i}.questionIds.${j}`,
          code: "design_unknown_question",
          message: `研究设计引用了不存在的题目：${questionId}`,
        });
    });
    if (construct.questionIds.length === 0)
      issues.push({
        path: `researchDesign.constructs.${i}.questionIds`,
        code: "design_construct_unmapped",
        message: `维度「${construct.label}」还没有对应题目`,
      });
  });
  // 试填反馈是历史记录，题目删后不追改：只在设计校验里提示悬空引用，不阻断发布。
  design.pretest?.itemFeedback?.forEach((item, i) => {
    if (!questionIds.has(item.questionId))
      issues.push({
        path: `researchDesign.pretest.itemFeedback.${i}.questionId`,
        code: "design_unknown_question",
        message: `试填反馈引用了不存在的题目：${item.questionId}`,
      });
  });
  const variableIds = new Set(surveyVariables(definition).map((variable) => variable.id));
  const refIssue = (ref: string, path: string): void => {
    const [kind, id] = ref.split(":") as [string, string];
    const known = kind === "construct" ? constructIds.has(id) : variableIds.has(id);
    if (!known)
      issues.push({
        path,
        code: "design_unknown_reference",
        message: `分析模型引用了不存在的${kind === "construct" ? "构念" : "变量"}：${ref}`,
      });
  };
  const modelIds = new Set<string>();
  design.analysisModels?.forEach((model, i) => {
    const at = `researchDesign.analysisModels.${i}`;
    if (modelIds.has(model.id))
      issues.push({ path: `${at}.id`, code: "duplicate_id", message: `分析模型 id 重复：${model.id}` });
    modelIds.add(model.id);
    if (model.kind === "efa") {
      if (!constructIds.has(model.constructId))
        issues.push({
          path: `${at}.constructId`,
          code: "design_unknown_reference",
          message: `分析模型引用了不存在的构念：construct:${model.constructId}`,
        });
      return;
    }
    const roles: Array<[string, string]> = [
      ["x", model.x],
      ["m", model.m],
      ["y", model.y],
      ["w", model.w],
    ];
    roles.forEach(([role, ref]) => refIssue(ref, `${at}.${role}`));
    if (new Set(roles.map(([, ref]) => ref)).size !== roles.length)
      issues.push({
        path: at,
        code: "design_role_overlap",
        message: "moderatedMediation 的 x/m/y/w 必须互异",
      });
    const covariateSeen = new Set<string>();
    model.covariates.forEach((ref, j) => {
      refIssue(ref, `${at}.covariates.${j}`);
      if (roles.some(([, roleRef]) => roleRef === ref))
        issues.push({
          path: `${at}.covariates.${j}`,
          code: "design_role_overlap",
          message: `协变量 ${ref} 与 x/m/y/w 重复`,
        });
      if (covariateSeen.has(ref))
        issues.push({
          path: `${at}.covariates.${j}`,
          code: "duplicate_id",
          message: `协变量重复：${ref}`,
        });
      covariateSeen.add(ref);
    });
    if (model.efa && !constructIds.has(model.efa.constructId))
      issues.push({
        path: `${at}.efa.constructId`,
        code: "design_unknown_reference",
        message: `分析模型引用了不存在的构念：construct:${model.efa.constructId}`,
      });
  });
  return issues;
}
