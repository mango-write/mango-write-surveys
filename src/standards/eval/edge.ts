import type { EdgeCase } from "./schema.js";

// 边界情况（wave2 填充）：≥5 例，至少 1 例 flag、1 例 not_flag、1 例 contextual。
export const edgeCases: EdgeCase[] = [
  {
    id: "edge.validated_agree_scale",
    title: "沿用已验证量表的同意度格式",
    situation:
      "态度量表整套题沿用某公开发表量表的原始同意度刻度，页说明标注了来源与授权，题干与端点均未自行改写。",
    relatedCheckIds: ["wording.acquiescence"],
    expected: "not_flag",
    rationale:
      "wording.acquiescence 的 severity.conditions 明确：整卷沿用已验证量表的原始同意度格式不算违反。本条针对自拟题，来源已记录即不报。",
  },
  {
    id: "edge.term_defined_inline",
    title: "题干缩写已在说明中定义",
    situation:
      "题干使用「生成式 AI」，页说明首段写明本卷指可生成文本的大语言模型工具，目标人群为高校研究生。",
    relatedCheckIds: ["wording.vague_terms"],
    expected: "not_flag",
    rationale:
      "该条 conditions 规定术语在题干或说明中已有明确定义时不算违反。关键名词已展开到目标人群可理解的程度，不应按行话上报。",
  },
  {
    id: "edge.followup_with_showif",
    title: "追问由筛选题显示条件兜底",
    situation:
      "追问「你使用 ChatGPT 写文献综述时遇到的主要困难」只在「是否使用过生成式 AI」选择「是」时显示，未使用者看不到此题。",
    relatedCheckIds: ["wording.presumptive"],
    expected: "not_flag",
    rationale:
      "presumptive 的 conditions 写明前提已由前面的筛选题与 showIf 条件覆盖时不适用。追问人群与前提一致，不构成预设错误。",
  },
  {
    id: "edge.timeframe_declared_once",
    title: "全卷统一声明时间口径",
    situation:
      "所有行为频率题都在问卷首页说明统一回忆期为「过去一学期」，题目本身未重复写时间，分析计划也按同一口径解释。",
    relatedCheckIds: ["wording.timeframe"],
    expected: "not_flag",
    rationale:
      "该条 conditions 允许研究说明统一声明口径、题目未写也不产生歧义时降级豁免。口径已在受访者可见处声明，不应按缺失回忆期上报。",
  },
  {
    id: "edge.single_object_with_qualifier",
    title: "限定语不是并列评价对象",
    situation:
      "题干「你对实验课的设备维护状况满意吗」中的「设备」是「维护状况」的限定，不是与「维护状况」并列的第二个评价对象。",
    relatedCheckIds: ["wording.double_barrel"],
    expected: "not_flag",
    rationale:
      "double_barrel 的 conditions 声明：两个并列对象中有一个只是另一个的限定说明时不构成双重提问。这里实际只评价一个对象。",
  },
  {
    id: "edge.jargon_without_pretest",
    title: "面向实务人群的专业缩写",
    situation:
      "面向县域中学教师的问卷使用「TPACK」「形成性评价」等术语，未做认知访谈或预测试，研究者认为教师都懂。",
    relatedCheckIds: [
      "sampling_recruitment.language_mismatch",
      "coverage.comprehension_pretest",
      "wording.vague_terms",
    ],
    expected: "flag",
    rationale:
      "language_mismatch 与 comprehension_pretest 都以目标人群理解为判据，研究者自评不能替代真人核实。术语未定义且无预测试证据，属于容易漏报的实质缺陷。",
  },
  {
    id: "edge.sensitive_optional_still_biased",
    title: "敏感题设为非必答仍为直陈式",
    situation:
      "「你是否在实验中篡改过数据」设为非必答并承诺匿名，但仍是直接询问本人违规行为的自证式题干。",
    relatedCheckIds: [
      "wording.social_desirability",
      "analysis_fit.required_missing_design",
    ],
    expected: "flag",
    rationale:
      "非必答只解决拒答，不解决直陈羞耻感。social_desirability 要求降低道德压力或改非自证口径，因此仍应上报，不能把「可以跳过」当豁免。",
  },
  {
    id: "edge.single_item_indicator",
    title: "单题承载的指标是否算维度",
    situation:
      "研究「科研协作」只用一道频率题；分析计划只报该题分布，报告称其为「协作指标」，不称维度得分、也不做信度。",
    relatedCheckIds: ["coverage.items_per_dimension", "analysis_fit.scale_without_plan"],
    expected: "contextual",
    rationale:
      "items_per_dimension 适用于拟合成维度得分的多题测量。若坚持只做单题描述且报告口径一致，可降为单题指标而不报；判定须结合分析计划与结论措辞。",
  },
  {
    id: "edge.grade_as_degree_proxy",
    title: "年级能否替代学位类型分组",
    situation:
      "某项目专硕与学硕按年级固定分流（研一全为专硕、研二起全为学硕），问卷只采集年级，研究问题仍为两类学位比较。",
    relatedCheckIds: [
      "coverage.missing_group_variable",
      "analysis_fit.analysis_plan_mapping",
    ],
    expected: "contextual",
    rationale:
      "missing_group_variable 要求分组可唯一还原。若该机构培养方案确实一一对应且报告写明映射依据，年级可作代理，否则不可；判定依赖目标人群的培养制度，必须带上下文。",
  },
  {
    id: "edge.small_cell_counts",
    title: "比较组小单元格只报计数",
    situation:
      "五组交叉后有若干单元格 n=4，分析计划规定 n<10 只报计数，正文不对这些单元格作组间解释。",
    relatedCheckIds: [
      "analysis_fit.group_sample_feasibility",
      "sampling_recruitment.group_reach",
    ],
    expected: "contextual",
    rationale:
      "group_sample_feasibility 的 conditions 允许比较指标少、样本充足且已声明小单元格规则时降级。是否可接受取决于研究问题能否收窄到计数描述，须看完整分析计划。",
  },
];
