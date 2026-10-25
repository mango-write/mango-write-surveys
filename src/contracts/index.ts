// 问卷 wire 契约（issue #216）。规则权威在 ../core（纯模块，前后端共用），
// 这里只 reexport 其 schema/类型并定义跨网 DTO；时间戳一律 ISO 字符串。
import { z } from "zod";

import {
  SurveyAnswersSchema,
  SurveyDefinitionSchema,
  SurveyIssueSchema,
  SurveyOpSchema,
} from "../core/index.js";

const IdSchema = z.string().regex(z.regexes.guid);

export {
  SURVEY_LIMITS,
  SurveyAnswersSchema,
  SurveyAnswerValueSchema,
  SurveyConditionSchema,
  SurveyDateQuestionSchema,
  SurveyDefinitionSchema,
  SurveyDropdownQuestionSchema,
  SurveyImageMultipleQuestionSchema,
  SurveyImageSingleQuestionSchema,
  SurveyIssueSchema,
  SurveyMatrixMultipleQuestionSchema,
  SurveyMatrixSingleQuestionSchema,
  SurveyMatrixTextQuestionSchema,
  SurveyMultiTextQuestionSchema,
  SurveyMultipleQuestionSchema,
  SurveyNpsQuestionSchema,
  SurveyNumberQuestionSchema,
  SurveyOpSchema,
  SurveyOptionSchema,
  SurveyPageSchema,
  SurveyQuestionSchema,
  SurveyQuestionTypeSchema,
  SurveyRankingQuestionSchema,
  SurveyRatingQuestionSchema,
  SurveyScaleQuestionSchema,
  SurveySingleQuestionSchema,
  SurveyStatementQuestionSchema,
  SurveyTextQuestionSchema,
  SurveyTimeQuestionSchema,
  SurveyIsoDateSchema,
} from "../core/index.js";
export type {
  SurveyAnswers,
  SurveyAnswerValue,
  SurveyCondition,
  SurveyDateQuestion,
  SurveyDefinition,
  SurveyDropdownQuestion,
  SurveyImageMultipleQuestion,
  SurveyImageSingleQuestion,
  SurveyIssue,
  SurveyLabeledNode,
  SurveyMatrixMultipleQuestion,
  SurveyMatrixSingleQuestion,
  SurveyMatrixTextQuestion,
  SurveyMultiTextQuestion,
  SurveyMultipleQuestion,
  SurveyNpsQuestion,
  SurveyNumberQuestion,
  SurveyOp,
  SurveyOption,
  SurveyPage,
  SurveyQuestion,
  SurveyQuestionType,
  SurveyRankingQuestion,
  SurveyRatingQuestion,
  SurveyScaleQuestion,
  SurveySingleQuestion,
  SurveyStatementQuestion,
  SurveyTextQuestion,
  SurveyTimeQuestion,
} from "../core/index.js";
export {
  surveyVariables,
  surveyVariablesOf,
  surveyCellValue,
  type SurveyColumnVariable,
  type SurveyVariableKind,
} from "../core/index.js";

const IsoDateTimeSchema = z.string().datetime();

/** 高熵 URL-safe 公开 slug（服务端生成，客户端只能透传）。 */
export const SurveySlugSchema = z.string().regex(/^[A-Za-z0-9_-]{12,64}$/);
export type SurveySlug = z.infer<typeof SurveySlugSchema>;

const TokenSchema = z.string().min(1).max(256);

export const SurveyStatusSchema = z.enum([
  "draft",
  "published",
  "paused",
  "closed",
]);
export type SurveyStatus = z.infer<typeof SurveyStatusSchema>;

export const SurveySummarySchema = z.object({
  id: IdSchema,
  userId: z.string().min(1),
  teamId: IdSchema.nullable(),
  title: z.string().min(1).max(200),
  slug: SurveySlugSchema,
  status: SurveyStatusSchema,
  /** 草稿从未发布过则为 null。 */
  currentRevisionId: IdSchema.nullable(),
  draftVersion: z.number().int().min(1),
  completedCount: z.number().int().min(0),
  responseLimit: z.number().int().min(1),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SurveySummary = z.infer<typeof SurveySummarySchema>;

export const SurveyRevisionSummarySchema = z.object({
  id: IdSchema,
  revision: z.number().int().min(1),
  createdAt: IsoDateTimeSchema,
  /** 发布快照的 sha256（canonical JSON）；工作台据此判「草稿有未发布修改」。 */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SurveyRevisionSummary = z.infer<typeof SurveyRevisionSummarySchema>;

export const SurveyDetailSchema = SurveySummarySchema.extend({
  /** 已开始的作答行数（含未提交会话）；completedCount 只数已完成。 */
  startedCount: z.number().int().min(0),
  definition: SurveyDefinitionSchema,
  revisions: z.array(SurveyRevisionSummarySchema),
  canWrite: z.boolean(),
  canDelete: z.boolean(),
});
export type SurveyDetail = z.infer<typeof SurveyDetailSchema>;

export const CreateSurveyInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
});
export type CreateSurveyInput = z.infer<typeof CreateSurveyInputSchema>;

export const UpdateSurveyInputSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  definition: SurveyDefinitionSchema,
  /** 回收上限（surveys 表列，非发布快照字段）；与 definition 同一 PATCH、
   *  共用 expectedVersion 乐观锁。缺省 = 本次不动它。 */
  responseLimit: z.number().int().min(1).max(10000).optional(),
});
export type UpdateSurveyInput = z.infer<typeof UpdateSurveyInputSchema>;

export const SetSurveyStatusInputSchema = z.strictObject({
  status: z.enum(["published", "paused", "closed"]),
});
export type SetSurveyStatusInput = z.infer<typeof SetSurveyStatusInputSchema>;

export const PublicSurveySchema = z.object({
  id: IdSchema,
  slug: SurveySlugSchema,
  status: SurveyStatusSchema,
  revisionId: IdSchema,
  definition: SurveyDefinitionSchema,
  // 回收名额是否已满（对当前采集版本而言）。公开面不给计数，只给这一个布尔，
  // 供作答落地页出「名额已满」预提示；已有会话仍可续答，提交时服务端终审。
  quotaReached: z.boolean(),
});
export type PublicSurvey = z.infer<typeof PublicSurveySchema>;

export const StartSurveyInputSchema = z.strictObject({
  resumeToken: TokenSchema.optional(),
  consent: z.literal(true),
});
export type StartSurveyInput = z.infer<typeof StartSurveyInputSchema>;

export const SurveyReceiptSchema = z.object({
  responseId: IdSchema,
  revisionId: IdSchema,
  completedAt: IsoDateTimeSchema,
});
export type SurveyReceipt = z.infer<typeof SurveyReceiptSchema>;

export const SurveySessionSchema = z.object({
  sessionToken: TokenSchema,
  revisionId: IdSchema,
  definition: SurveyDefinitionSchema,
  expiresAt: IsoDateTimeSchema,
  /** 该会话已提交过时携带既有回执（幂等重试）。 */
  receipt: SurveyReceiptSchema.optional(),
});
export type SurveySession = z.infer<typeof SurveySessionSchema>;

export const SubmitSurveyInputSchema = z.strictObject({
  sessionToken: TokenSchema,
  answers: SurveyAnswersSchema,
  honeypot: z.string().max(2000).optional(),
});
export type SubmitSurveyInput = z.infer<typeof SubmitSurveyInputSchema>;

/** 题目选项图的上传回执（POST /api/surveys/:id/media）。fileId 即定义里
 *  imageFileId 引用的 survey_files 行；url 是作者认证侧的读取地址。 */
export const SurveyMediaSchema = z.object({
  id: IdSchema,
  surveyId: IdSchema,
  name: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mime: z.string().min(1),
  bytes: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
  url: z.string().min(1),
});
export type SurveyMedia = z.infer<typeof SurveyMediaSchema>;

export const SurveyResponseViewSchema = z.object({
  id: IdSchema,
  revisionId: IdSchema,
  answers: SurveyAnswersSchema,
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  durationMs: z.number().int().min(0),
});
export type SurveyResponseView = z.infer<typeof SurveyResponseViewSchema>;

/**
 * 问卷交付载荷（issue #217，与主仓 @mango-write/contracts 的 ToolSurveyDelivery
 * 同构；本包持有同一定义的投影，宿主桥适配时零转换）。survey_edit 由工作区页在
 * 本地草稿上重放 ops（进撤销栈 + 自动保存 + toast）；survey_create 由列表页/
 * 工作区导航到新问卷。只经活流发一次（刷新回放不重放，add 类操作重复应用会重复加题）。
 */
export const ToolSurveyDeliverySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("survey_edit"),
    surveyId: IdSchema,
    /** 本次 AI 操作的身份（宿主按「一次用户操作」生成、跨重试稳定）：
     *  交付去重与建卷幂等的公钥，不回灌模型。 */
    operationId: z.string().min(6).max(64),
    /** 服务端校验 ops 时所依据的持久草稿版本。页面与本地副本对不上
     *  （版本不一致或有未落盘编辑）时不自动应用，转人工确认。 */
    baseDraftVersion: z.number().int().min(1),
    /** 模型给的一句话修改摘要（toast 与历史条目标签）。 */
    summary: z.string().max(300),
    /** 实际应用的操作（SurveyOp 词表，含服务端生成的 id）——宿主页在本地当前
     *  草稿上重放这批操作，与撤销栈合流。 */
    appliedOps: z.array(SurveyOpSchema).max(200),
    /** 被拒绝的操作数与原因（宿主 toast 如实告知）。 */
    rejected: z.array(z.object({ reason: z.string().max(300) })).max(200).optional(),
    /** 应用后的语义校验结果（如空页、条件不可达），供用户在画布校验列表消化。 */
    issues: z.array(SurveyIssueSchema).max(200).optional(),
  }),
  z.object({
    type: z.literal("survey_create"),
    surveyId: IdSchema,
    /** 同上：surveyId 由 (userId, operationId) 确定性派生，同一次操作的重试
     *  返回同一份问卷，不重复建卷。 */
    operationId: z.string().min(6).max(64),
    title: z.string().max(200),
    issues: z.array(SurveyIssueSchema).max(200).optional(),
  }),
]);
export type ToolSurveyDelivery = z.infer<typeof ToolSurveyDeliverySchema>;

/** 变量字典与不可变发布定义（GET /codebook），不含答卷内容。 */
export const SurveyCodebookSchema = z.object({
  definition: SurveyDefinitionSchema,
  surveyId: IdSchema,
  revisionId: IdSchema,
  revision: z.number().int().min(1),
  variables: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      kind: z.string().min(1),
      options: z
        .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
        .optional(),
    }),
  ),
});
export type SurveyCodebook = z.infer<typeof SurveyCodebookSchema>;
