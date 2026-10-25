// 研究标准目录的数据词表（主仓 issue #224 阶段 1）：方法学检查标准的单源。
// 目录描述「研究质量标准」；结构合法性归 core/validate-definition，两层互补
// 不重复。条目分级 rule / judgment / human_data 对应阶段 3 的规则检查、AI
// 审查与真人/数据验证三路实现；severity 语义见 review-protocol.ts。
import { z } from "zod";
import { SurveyQuestionTypeSchema, SurveyReviewSeveritySchema } from "../core/definition.js";

// 首批覆盖的三类研究（issue #224 阶段 1）：id 进 appliesTo 与评测集引用。
export const RESEARCH_TYPE_IDS = [
  "status_survey",
  "group_comparison",
  "attitude_scale",
] as const;
export const ResearchTypeIdSchema = z.enum(RESEARCH_TYPE_IDS);
export type ResearchTypeId = z.infer<typeof ResearchTypeIdSchema>;

export const CHECK_DIMENSIONS = [
  "research_goal",
  "sampling_recruitment",
  "coverage",
  "wording",
  "options",
  "flow",
  "burden",
  "analysis_fit",
] as const;
export const CheckDimensionSchema = z.enum(CHECK_DIMENSIONS);
export type CheckDimension = z.infer<typeof CheckDimensionSchema>;

// 引用只能指向来源登记表（SOURCES）；note 写支撑本条的原则名或主题短语，
// 不得编造页码/节号。COSMIN 借鉴须在 note 说明适用范围。
export const SOURCE_IDS = ["aapor", "pew", "cdc_cognitive", "cosmin", "product"] as const;
export const StandardsSourceIdSchema = z.enum(SOURCE_IDS);
export type StandardsSourceId = z.infer<typeof StandardsSourceIdSchema>;

export const SOURCES: Record<
  StandardsSourceId,
  { label: string; url: string; covers: string }
> = {
  aapor: {
    label: "AAPOR 调查最佳实践",
    url: "https://aapor.org/standards-and-ethics/best-practices/",
    covers:
      "Planning Your Survey（目标先行、已有数据是否够用）/ Designing Your Sample（抽样框、概率与非概率样本）/ Designing your questionnaire（一次一个概念、选项互斥完备、题序、预测试）/ Fielding your Survey（认知访谈、试点、全过程质控）",
  },
  pew: {
    label: "Pew 问卷题目设计",
    url: "https://www.pewresearch.org/writing-survey-questions/",
    covers:
      "Question development / Open- and closed-ended questions（选项、轮换、互斥完备、逐项是/否与多选格式差异）/ Question wording（双重提问、具体语言、否定、情绪化措辞、默许与社会期许风险）/ Question order（顺序效应）",
  },
  cdc_cognitive: {
    label: "CDC 认知访谈",
    url: "https://www.cdc.gov/nchs/ccqder/question-evaluation/cognitive-interviewing.html",
    covers:
      "作答复核模型四过程：comprehension（理解）/ recall（回忆）/ judgment（判断）/ response（选项匹配）；目的抽样 20-50 人找问题而非估计",
  },
  cosmin: {
    label: "COSMIN 方法手册 V2",
    url: "https://www.cosmin.nl/wp-content/uploads/COSMIN-manual-V2_final.pdf",
    covers:
      "内容效度三要素：relevance（题目与研究构念相关）/ comprehensiveness（覆盖构念全域）/ comprehensibility（目标人群可理解）；主要面向健康测量工具，借须注明适用范围",
  },
  product: {
    label: "本仓产品规格",
    url: "https://github.com/mango-write/mango-write/blob/dev/docs/product/surveys.md",
    covers:
      "系统能力边界：题型词表与上限（docs/product/surveys.md）、变量类型与当前分析方法（docs/product/research-data.md：描述统计/分组/交叉表/固定运行，无推断检验与信度分析）——检查条目涉及系统能否执行时引用",
  },
};

export const CheckClassificationSchema = z.enum(["rule", "judgment", "human_data"]);
export type CheckClassification = z.infer<typeof CheckClassificationSchema>;

export const CheckSeveritySchema = SurveyReviewSeveritySchema;
export type CheckSeverity = z.infer<typeof CheckSeveritySchema>;

export const CheckCitationSchema = z.object({
  source: StandardsSourceIdSchema,
  note: z.string().min(1).max(500),
});

export const CheckAppliesToSchema = z.object({
  // 缺省 = 全部研究类型 / 全部题型。
  researchTypes: z.array(ResearchTypeIdSchema).optional(),
  questionTypes: z.array(SurveyQuestionTypeSchema).optional(),
  // 适用条件与不适用情形的补充说明；researchTypes/questionTypes 缺省时必填。
  notes: z.string().max(1000).optional(),
});

export const StandardsCheckSchema = z.object({
  // <dimension>.<slug>，如 wording.double_barrel；前缀必须与 dimension 一致。
  id: z.string().regex(/^[a-z]+(_[a-z0-9]+)*\.[a-z0-9]+(_[a-z0-9]+)*$/),
  dimension: CheckDimensionSchema,
  title: z.string().min(2).max(40),
  // 标准主张：查什么、判据是什么（不是处理方式）。
  claim: z.string().min(10).max(800),
  citations: z.array(CheckCitationSchema).min(1),
  appliesTo: CheckAppliesToSchema,
  classification: CheckClassificationSchema,
  severity: z.object({
    level: CheckSeveritySchema,
    // 升降级情形说明（何种情况下 major 降 minor 等）。
    conditions: z.string().max(500).optional(),
  }),
  errorExample: z.object({
    description: z.string().min(5).max(500),
    // 反例原文（题目或选项片段），能引用原文时必填。
    snippet: z.string().max(600).optional(),
    why: z.string().min(5).max(500),
  }),
  handling: z.string().min(10).max(800),
});
export type StandardsCheck = z.infer<typeof StandardsCheckSchema>;

export const ResearchTypeSchema = z.object({
  id: ResearchTypeIdSchema,
  name: z.string().min(2).max(40),
  definition: z.string().min(10).max(800),
  whenAppropriate: z.array(z.string().min(5).max(300)).min(2),
  limitations: z.array(z.string().min(5).max(300)).min(2),
  // 当前系统怎么服务这类研究：research-data 已有能力与明确做不了的事。
  analysisFit: z.string().min(10).max(800),
});
export type ResearchType = z.infer<typeof ResearchTypeSchema>;

export interface StandardsCatalogIssue {
  path: string;
  message: string;
}

// 目录级交叉校验（zod 之上的不变量）：id 唯一、前缀与维度一致、来源登记在
// 案、缺省适用范围必须给出 notes。返回 issue 列表，空数组 = 目录合格。
export function validateStandardsCatalog(
  checks: StandardsCheck[],
): StandardsCatalogIssue[] {
  const issues: StandardsCatalogIssue[] = [];
  const seen = new Set<string>();
  for (const check of checks) {
    const parsed = StandardsCheckSchema.safeParse(check);
    if (!parsed.success) {
      issues.push({
        path: check.id ?? "<unknown>",
        message: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
      continue;
    }
    if (seen.has(check.id)) {
      issues.push({ path: check.id, message: "检查项 id 重复" });
    }
    seen.add(check.id);
    const prefix = check.id.split(".")[0];
    if (prefix !== check.dimension) {
      issues.push({
        path: check.id,
        message: `id 前缀 ${prefix} 与 dimension ${check.dimension} 不一致`,
      });
    }
    if (
      !check.appliesTo.researchTypes &&
      !check.appliesTo.questionTypes &&
      !check.appliesTo.notes
    ) {
      issues.push({
        path: check.id,
        message: "适用范围为全量时必须给 appliesTo.notes 说明适用边界",
      });
    }
  }
  return issues;
}
