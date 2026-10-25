// 评测集数据词表（主仓 issue #224 阶段 1 第三项）。四类数据各司其职：
// excellent 钉「合格长什么样」（含阶段 2 的研究映射），defects 钉「典型
// 缺陷长什么样」并标注真值，edge 钉「不能误报/需上下文」的边界，tasks
// 钉新手端到端任务。checkId 一律引用 ../index 的 STANDARDS_CHECKS，
// 门禁（eval-dataset.test.ts）负责引用闭合与变量类型一致性。
import { z } from "zod";
import { SurveyDefinitionSchema } from "../../core/definition.js";
import { ResearchTypeIdSchema } from "../schema.js";

const caseId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}\\.[a-z0-9]+(_[a-z0-9]+)*$`));

// 阶段 2「研究问题 → 概念/维度 → 指标 → 题目 → 变量与计分 → 预期分析」
// 映射的评测形态：variableKind 必须与该题目实际展开的变量类型一致。
export const MappingEntrySchema = z.object({
  questionId: z.string().min(1),
  researchQuestion: z.string().min(5).max(300),
  concept: z.string().min(2).max(100),
  indicator: z.string().min(2).max(200),
  variableKind: z.string().min(3),
  plannedAnalysis: z.string().min(5).max(300),
});
export type MappingEntry = z.infer<typeof MappingEntrySchema>;

export const ExcellentCaseSchema = z.object({
  id: caseId("excellent"),
  researchType: ResearchTypeIdSchema,
  title: z.string().min(2).max(80),
  scenario: z.string().min(10).max(300),
  // 新手最初的一句话需求（含模糊处），评测生成链路时以它为起点。
  noviceBrief: z.string().min(5).max(300),
  definition: SurveyDefinitionSchema,
  mapping: z.array(MappingEntrySchema).min(1),
  strengths: z
    .array(z.object({ checkId: z.string().min(1), note: z.string().min(5).max(300) }))
    .min(1),
});
export type ExcellentCase = z.infer<typeof ExcellentCaseSchema>;

export const DefectCaseSchema = z.object({
  id: caseId("defect"),
  researchType: ResearchTypeIdSchema.optional(),
  title: z.string().min(2).max(80),
  definition: SurveyDefinitionSchema,
  // 标注真值：这些缺陷确实存在（评测诊断链路的召回基准）。
  planted: z
    .array(
      z.object({
        checkId: z.string().min(1),
        // 命中位置应是定义里的题目 id 或 pages.N 这类路径。
        at: z.string().min(1).max(120),
        note: z.string().min(5).max(300),
      }),
    )
    .min(1),
  // 陷阱：看似问题但按标准不该报（评测误报基准）。
  mustNotFlag: z
    .array(z.object({ checkId: z.string().min(1), note: z.string().min(5).max(300) }))
    .optional(),
});
export type DefectCase = z.infer<typeof DefectCaseSchema>;

export const EdgeCaseSchema = z.object({
  id: caseId("edge"),
  title: z.string().min(2).max(80),
  situation: z.string().min(10).max(500),
  reviewQuestion: z.string().min(5).max(300),
  relatedCheckIds: z.array(z.string().min(1)).min(1),
  // contextual = 判定依赖研究目标或人群上下文，评测时必须带上下文判。
  expected: z.enum(["flag", "not_flag", "contextual"]),
  rationale: z.string().min(10).max(500),
});
export type EdgeCase = z.infer<typeof EdgeCaseSchema>;

export const NoviceTaskSchema = z.object({
  id: caseId("task"),
  title: z.string().min(2).max(80),
  scenario: z.string().min(10).max(300),
  initialPrompt: z.string().min(10).max(500),
  // Copilot 应问出的澄清：topic + 通俗问法示例（阶段 2 追问链路的基准）。
  expectedClarifications: z
    .array(
      z.object({
        topic: z.string().min(2).max(60),
        sampleQuestion: z.string().min(5).max(200),
      }),
    )
    .min(2),
  expectedResearchType: ResearchTypeIdSchema,
  successCriteria: z.array(z.string().min(5).max(200)).min(2),
});
export type NoviceTask = z.infer<typeof NoviceTaskSchema>;
