// 问卷定义的纯数据词表（issue #216）：Node/浏览器共用，只依赖 zod。
// 产品上限见 docs/product/surveys.md。
import { z } from "zod";

export const SURVEY_LIMITS = {
  maxQuestions: 50,
  maxPages: 20,
  maxOptionsPerQuestion: 30,
  maxTextLength: 2000,
  maxTitleLength: 200,
  maxQuestionTitleLength: 500,
  maxPageTitleLength: 200,
  maxOptionLabelLength: 200,
  maxDescriptionLength: 2000,
  maxConsentLength: 2000,
  maxPageDescriptionLength: 2000,
  maxScaleSpan: 10,
  maxMatrixRows: 20,
  maxMatrixColumns: 10,
  maxMultiTextItems: 20,
  maxStatementLength: 2000,
  maxDesignTextLength: 2000,
  maxDesignNoteLength: 500,
  maxDesignNotes: 20,
  maxConstructs: 20,
  maxConstructLabelLength: 200,
  maxConstructDefinitionLength: 1000,
  maxTimeBudgetMinutes: 600,
} as const;

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine(
    (id) => !Object.hasOwn(Object.prototype, id),
    "保留标识符不可作为研究字段",
  );

export const SurveyConditionSchema = z.object({
  questionId: idSchema,
  op: z.enum(["eq", "contains"]),
  value: z.union([
    z.string().max(SURVEY_LIMITS.maxTextLength),
    z.number().finite(),
  ]),
});
export type SurveyCondition = z.infer<typeof SurveyConditionSchema>;

export const SurveyOptionSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(SURVEY_LIMITS.maxOptionLabelLength),
  exclusive: z.boolean().optional(),
  // 图片单选/多选的选项图：指向 survey_files 绑定行（字节在 sha256 去重池）。
  // 无图选项合法（允许图文混排）；字段随选项族在换题型时保留（载荷不丢），但
  // 渲染/发布校验/导出只在 image_* 题型上认它。imageFileId 与 imageUrl 都不进
  // 变量字典；imageUrl 是只读派生输出（公开投影把 imageFileId 解析成资产 URL），
  // 客户端塞进草稿的值会被 zod parse 剥掉，权威值只在公开投影生成。
  imageFileId: z.string().min(1).max(64).optional(),
  // 只读派生输出：公开定义投影把 imageFileId 解析成可直连的资产 URL；
  // zod parse 会剥掉客户端塞进草稿的值，权威值只在公开投影生成。
  imageUrl: z.string().max(2048).optional(),
});
export type SurveyOption = z.infer<typeof SurveyOptionSchema>;

// 矩阵行/列与多项填空项不带 exclusive：多出来的语义只会造成「配了却无效」。
const labeledNodeSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(SURVEY_LIMITS.maxOptionLabelLength),
});
export type SurveyLabeledNode = z.infer<typeof labeledNodeSchema>;

// date min/max 与 date 答案共用同一格式：ISO 日历日（YYYY-MM-DD），真日期。
export const SurveyIsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "日期不合法");

const questionBase = {
  id: idSchema,
  title: z.string().min(1).max(SURVEY_LIMITS.maxQuestionTitleLength),
  required: z.boolean(),
  showIf: SurveyConditionSchema.optional(),
};

export const SurveySingleQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("single"),
  options: z.array(SurveyOptionSchema).max(SURVEY_LIMITS.maxOptionsPerQuestion),
});
export type SurveySingleQuestion = z.infer<typeof SurveySingleQuestionSchema>;

export const SurveyMultipleQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("multiple"),
  options: z.array(SurveyOptionSchema).max(SURVEY_LIMITS.maxOptionsPerQuestion),
  minChoices: z.number().int().min(0).optional(),
  maxChoices: z.number().int().positive().optional(),
});
export type SurveyMultipleQuestion = z.infer<
  typeof SurveyMultipleQuestionSchema
>;

// 图片单选/多选：选项可带图（imageFileId），作答与 showIf 同 single/multiple。
export const SurveyImageSingleQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("image_single"),
  options: z.array(SurveyOptionSchema).max(SURVEY_LIMITS.maxOptionsPerQuestion),
});
export type SurveyImageSingleQuestion = z.infer<
  typeof SurveyImageSingleQuestionSchema
>;

export const SurveyImageMultipleQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("image_multiple"),
  options: z.array(SurveyOptionSchema).max(SURVEY_LIMITS.maxOptionsPerQuestion),
  minChoices: z.number().int().min(0).optional(),
  maxChoices: z.number().int().positive().optional(),
});
export type SurveyImageMultipleQuestion = z.infer<
  typeof SurveyImageMultipleQuestionSchema
>;

export const SurveyTextQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("text"),
  multiline: z.boolean().optional(),
  maxLength: z
    .number()
    .int()
    .positive()
    .max(SURVEY_LIMITS.maxTextLength)
    .optional(),
});
export type SurveyTextQuestion = z.infer<typeof SurveyTextQuestionSchema>;

export const SurveyNumberQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("number"),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
});
export type SurveyNumberQuestion = z.infer<typeof SurveyNumberQuestionSchema>;

export const SurveyScaleQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("scale"),
  min: z.number().int(),
  max: z.number().int(),
  minLabel: z.string().max(SURVEY_LIMITS.maxOptionLabelLength).optional(),
  maxLabel: z.string().max(SURVEY_LIMITS.maxOptionLabelLength).optional(),
});
export type SurveyScaleQuestion = z.infer<typeof SurveyScaleQuestionSchema>;

export const SurveyDropdownQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("dropdown"),
  options: z.array(SurveyOptionSchema).max(SURVEY_LIMITS.maxOptionsPerQuestion),
});
export type SurveyDropdownQuestion = z.infer<
  typeof SurveyDropdownQuestionSchema
>;

// rating 档位 3–10（星形可点）；默认 5 由编辑器落载荷，schema 不给 default：
// 老定义没有 rating，新定义缺 max 视为形状错误，避免静默档位。
export const SurveyRatingQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("rating"),
  max: z.number().int().min(3).max(10),
});
export type SurveyRatingQuestion = z.infer<typeof SurveyRatingQuestionSchema>;

// NPS 固定 0–10；两端锚点可选，编辑器默认落「完全不可能 / 极有可能」。
export const SurveyNpsQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("nps"),
  minLabel: z.string().max(SURVEY_LIMITS.maxOptionLabelLength).optional(),
  maxLabel: z.string().max(SURVEY_LIMITS.maxOptionLabelLength).optional(),
});
export type SurveyNpsQuestion = z.infer<typeof SurveyNpsQuestionSchema>;

export const SurveyDateQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("date"),
  min: SurveyIsoDateSchema.optional(),
  max: SurveyIsoDateSchema.optional(),
});
export type SurveyDateQuestion = z.infer<typeof SurveyDateQuestionSchema>;

export const SurveyTimeQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("time"),
});
export type SurveyTimeQuestion = z.infer<typeof SurveyTimeQuestionSchema>;

export const SurveyRankingQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("ranking"),
  options: z.array(SurveyOptionSchema).max(SURVEY_LIMITS.maxOptionsPerQuestion),
});
export type SurveyRankingQuestion = z.infer<
  typeof SurveyRankingQuestionSchema
>;

const matrixRows = z
  .array(labeledNodeSchema)
  .min(1)
  .max(SURVEY_LIMITS.maxMatrixRows);
const matrixBase = {
  rows: matrixRows,
  columns: z
    .array(labeledNodeSchema)
    .min(2)
    .max(SURVEY_LIMITS.maxMatrixColumns),
};

export const SurveyMatrixSingleQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("matrix_single"),
  ...matrixBase,
});
export type SurveyMatrixSingleQuestion = z.infer<
  typeof SurveyMatrixSingleQuestionSchema
>;

export const SurveyMatrixMultipleQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("matrix_multiple"),
  ...matrixBase,
});
export type SurveyMatrixMultipleQuestion = z.infer<
  typeof SurveyMatrixMultipleQuestionSchema
>;

// 矩阵填空：每行一个文本输入，答案 { [rowId]: string }；必答 = 全行非空。
export const SurveyMatrixTextQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("matrix_text"),
  rows: matrixRows,
});
export type SurveyMatrixTextQuestion = z.infer<
  typeof SurveyMatrixTextQuestionSchema
>;

export const SurveyMultiTextQuestionSchema = z.object({
  ...questionBase,
  type: z.literal("multi_text"),
  items: z
    .array(labeledNodeSchema)
    .min(1)
    .max(SURVEY_LIMITS.maxMultiTextItems),
});
export type SurveyMultiTextQuestion = z.infer<
  typeof SurveyMultiTextQuestionSchema
>;

// 说明块不是题目：不收集答案、不可必答（validate 报 statement_not_required）、
// 不进变量字典。题干允许为空（body 即内容），其余题型的题干仍必填。
export const SurveyStatementQuestionSchema = z.object({
  ...questionBase,
  title: z.string().max(SURVEY_LIMITS.maxQuestionTitleLength),
  type: z.literal("statement"),
  body: z.string().max(SURVEY_LIMITS.maxStatementLength),
});
export type SurveyStatementQuestion = z.infer<
  typeof SurveyStatementQuestionSchema
>;

export const SurveyQuestionSchema = z.discriminatedUnion("type", [
  SurveySingleQuestionSchema,
  SurveyMultipleQuestionSchema,
  SurveyImageSingleQuestionSchema,
  SurveyImageMultipleQuestionSchema,
  SurveyTextQuestionSchema,
  SurveyNumberQuestionSchema,
  SurveyScaleQuestionSchema,
  SurveyDropdownQuestionSchema,
  SurveyRatingQuestionSchema,
  SurveyNpsQuestionSchema,
  SurveyDateQuestionSchema,
  SurveyTimeQuestionSchema,
  SurveyRankingQuestionSchema,
  SurveyMatrixSingleQuestionSchema,
  SurveyMatrixMultipleQuestionSchema,
  SurveyMatrixTextQuestionSchema,
  SurveyMultiTextQuestionSchema,
  SurveyStatementQuestionSchema,
]);
export type SurveyQuestion = z.infer<typeof SurveyQuestionSchema>;

// 题型词表从判别联合派生（单点权威，不维护第二份清单）：新增题型只改联合，
// 枚举自动跟上；数据集 questionTypes 投影与消费方以此为准。
export const SurveyQuestionTypeSchema = z.enum(
  SurveyQuestionSchema.options.map((option) => option.shape.type.value),
);
export type SurveyQuestionType = z.infer<typeof SurveyQuestionTypeSchema>;

// 研究设计依据（#224）：AI 建卷前先写清楚要回答什么、对谁、怎么分析，
// 诊断才有判据。旧问卷没有该字段（可选，不改 version:1）。
const designText = z.string().max(SURVEY_LIMITS.maxDesignTextLength);
const designNote = z.string().max(SURVEY_LIMITS.maxDesignNoteLength);

export const SurveyResearchConstructSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(SURVEY_LIMITS.maxConstructLabelLength),
  definition: z.string().min(1).max(SURVEY_LIMITS.maxConstructDefinitionLength),
  // 空数组 = 该维度尚无题目覆盖；validateSurveyDesign 报 design_construct_unmapped。
  questionIds: z.array(idSchema).max(SURVEY_LIMITS.maxQuestions),
});
export type SurveyResearchConstruct = z.infer<typeof SurveyResearchConstructSchema>;

// 作者自报的试填记录。它是作者声明，不是外部核验：诊断只能引用、不能据此宣称已验证。
export const SurveyResearchPretestSchema = z.object({
  participantCount: z.number().int().min(1).max(100000),
  notes: designText,
  recordedAt: z.string().datetime(),
});
export type SurveyResearchPretest = z.infer<typeof SurveyResearchPretestSchema>;

export const SurveyResearchDesignSchema = z.object({
  // 未知事实留空串而不是编造：人群/招募/许可不了解时写进 pendingDecisions。
  researchQuestion: designText,
  population: designText,
  recruitment: designText,
  purpose: z.enum(["describe", "compare", "measure"]),
  timeBudgetMinutes: z.number().int().min(1).max(SURVEY_LIMITS.maxTimeBudgetMinutes),
  constructs: z.array(SurveyResearchConstructSchema).max(SURVEY_LIMITS.maxConstructs),
  analysisPlan: designText,
  assumptions: z.array(designNote).max(SURVEY_LIMITS.maxDesignNotes),
  pendingDecisions: z.array(designNote).max(SURVEY_LIMITS.maxDesignNotes),
  pretest: SurveyResearchPretestSchema.optional(),
});
export type SurveyResearchDesign = z.infer<typeof SurveyResearchDesignSchema>;

// standards 复用本词表，诊断与方法目录保持同一分级。
export const SurveyReviewSeveritySchema = z.enum(["blocker", "major", "minor"]);
export type SurveyReviewSeverity = z.infer<typeof SurveyReviewSeveritySchema>;

export const SurveyPageSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(SURVEY_LIMITS.maxPageTitleLength),
  // 页说明走 markdown（issue #217）；老定义无此字段，留空即可。
  description: z
    .string()
    .max(SURVEY_LIMITS.maxPageDescriptionLength)
    .optional(),
  // 空页不在 schema 拦：它是编辑器合法的中间态，由 validateSurveyDefinition 报 empty_page。
  questionIds: z.array(idSchema).max(SURVEY_LIMITS.maxQuestions),
  jump: z
    .object({
      when: SurveyConditionSchema,
      targetPageId: idSchema,
    })
    .optional(),
});
export type SurveyPage = z.infer<typeof SurveyPageSchema>;

export const SurveyDefinitionSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(SURVEY_LIMITS.maxTitleLength),
  description: z.string().max(SURVEY_LIMITS.maxDescriptionLength),
  consent: z.string().max(SURVEY_LIMITS.maxConsentLength),
  questions: z.array(SurveyQuestionSchema).max(SURVEY_LIMITS.maxQuestions),
  pages: z.array(SurveyPageSchema).max(SURVEY_LIMITS.maxPages),
  researchDesign: SurveyResearchDesignSchema.optional(),
});
export type SurveyDefinition = z.infer<typeof SurveyDefinitionSchema>;

// 空答案省略 key、不用 null：record 值域不含 null，null 在 schema 层即被拒。
// record 分支服务矩阵/多项填空：子键是行/列/项 id（同样过 idSchema，__proto__ 在
// 键位置即被拒），值是列 id（矩阵单选/多项填空/矩阵填空）或列 id 数组（矩阵多选）。
const answerSubValueSchema = z.union([
  z.string().max(SURVEY_LIMITS.maxTextLength),
  z
    .array(z.string().max(SURVEY_LIMITS.maxOptionLabelLength))
    .max(SURVEY_LIMITS.maxOptionsPerQuestion),
]);

export const SurveyAnswerValueSchema = z.union([
  z.string().max(SURVEY_LIMITS.maxTextLength),
  z.number().finite(),
  z
    .array(z.string().max(SURVEY_LIMITS.maxOptionLabelLength))
    .max(SURVEY_LIMITS.maxOptionsPerQuestion),
  z.record(idSchema, answerSubValueSchema),
]);
export type SurveyAnswerValue = z.infer<typeof SurveyAnswerValueSchema>;

// Zod record 会跳过 __proto__；在解析前拒绝，避免未知答案被静默移除。
export const SurveyAnswersSchema = z.preprocess(
  (input, ctx) => {
    if (
      input &&
      typeof input === "object" &&
      Object.hasOwn(input, "__proto__")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["__proto__"],
        message: "保留标识符不可作为研究字段",
      });
      return z.NEVER;
    }
    return input;
  },
  z.record(idSchema, SurveyAnswerValueSchema),
);
export type SurveyAnswers = z.infer<typeof SurveyAnswersSchema>;

export const SurveyIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
export type SurveyIssue = z.infer<typeof SurveyIssueSchema>;
