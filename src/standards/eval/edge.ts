import type { EdgeCase } from "./schema.js";

// 边界情况（wave2 填充）：≥5 例，至少 1 例 flag、1 例 not_flag、1 例 contextual。
export const edgeCases: EdgeCase[] = [
  {
    id: "edge.validated_agree_scale",
    reviewQuestion: "仅因采用同意度格式，是否应要求修改该量表？不据题面声明认证来源或适用性。",
    title: "沿用已验证量表的同意度格式",
    situation:
      "态度量表整套题沿用某公开发表量表的原始同意度刻度，页说明标注了来源与授权，题干与端点均未自行改写。",
    relatedCheckIds: ["wording.acquiescence"],
    expected: "not_flag",
    rationale:
      "wording.acquiescence 的 severity.conditions 明确：整卷沿用已验证量表的原始同意度格式不算违反。不能单因格式要求改写；来源声明不等于已验证许可或人群适用性。",
  },
  {
    id: "edge.term_defined_inline",
    reviewQuestion: "是否存在术语完全未定义的问题？不据文字定义证明所有目标人群已经理解。",
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
    reviewQuestion: "该筛选条件是否足以覆盖使用 ChatGPT 写文献综述的追问前提？",
    title: "筛选条件比追问前提更宽",
    situation:
      "追问「你使用 ChatGPT 写文献综述时遇到的主要困难」只在「是否使用过生成式 AI」选择「是」时显示，未使用者看不到此题。",
    relatedCheckIds: ["wording.presumptive"],
    expected: "flag",
    rationale:
      "使用过生成式 AI 不蕴含使用过 ChatGPT，更不蕴含用它写过文献综述；筛选存在但未覆盖完整前提。应精确筛经历或提供不适用路径。",
  },
  {
    id: "edge.timeframe_declared_once",
    reviewQuestion: "是否仅因每题未重复回忆期就认定时间参照缺失？",
    title: "全卷统一声明时间口径",
    situation:
      "所有行为频率题都在问卷首页说明统一回忆期为「过去一学期」，题目本身未重复写时间，分析计划也按同一口径解释。",
    relatedCheckIds: ["wording.timeframe"],
    expected: "not_flag",
    rationale:
      "该条 conditions 规定卷首统一声明回忆期且各题口径一致时不报本项。口径已在受访者可见处声明，不应按缺失回忆期上报。",
  },
  {
    id: "edge.single_object_with_qualifier",
    reviewQuestion: "此题是否同时要求对两个可独立回答的对象评价？",
    title: "限定语不是并列评价对象",
    situation:
      "题干为「你对实验课的设备维护状况满意吗」，只提供一个满意度刻度作答。",
    relatedCheckIds: ["wording.double_barrel"],
    expected: "not_flag",
    rationale:
      "double_barrel 的 conditions 声明：两个并列对象中有一个只是另一个的限定说明时不构成双重提问。这里实际只评价一个对象。",
  },
  {
    id: "edge.jargon_without_pretest",
    reviewQuestion: "未定义术语且无目标人群理解证据时，是否应提示理解风险？不要求断言已经产生偏差。",
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
    reviewQuestion: "能否仅凭敏感主题与直陈式格式，就认定题目已产生严重偏差、必须改间接提问？",
    title: "敏感题的残余风险与已证实偏差",
    situation:
      "「你是否在实验中篡改过数据」设为非必答并承诺匿名，但仍是直接询问本人违规行为的自证式题干。",
    relatedCheckIds: [
      "wording.social_desirability",
      "analysis_fit.required_missing_design",
    ],
    expected: "contextual",
    rationale:
      "可以提示社会期许风险，但匿名和可跳答已有缓解；缺少实际作答证据与用途，不能确证严重偏差或认定间接提问必然更好。",
  },
  {
    id: "edge.single_item_indicator",
    reviewQuestion: "在此描述与分析计划下，是否仅因题数为一而判为题量不足或合成计划缺失？",
    title: "单题承载的指标是否算维度",
    situation:
      "研究「科研协作」只用一道频率题；分析计划只报该题分布，报告称其为「协作指标」，不称维度得分、也不做信度。",
    relatedCheckIds: ["coverage.items_per_dimension", "analysis_fit.scale_without_plan"],
    expected: "not_flag",
    rationale:
      "计划与报告都明确为单题指标，不合成得分，不因题量为一报错；这不证明其覆盖科研协作的全部含义。",
  },
  {
    id: "edge.grade_as_degree_proxy",
    reviewQuestion: "在尚未核验机构映射依据时，能否将年级确定视为学位类型的有效替代？",
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
    reviewQuestion: "仅因小单元格 n=4 而判为严重比较缺陷是否成立？不评判完整研究目标与样本可达性。",
    title: "比较组小单元格只报计数",
    situation:
      "五组交叉后有若干单元格 n=4，分析计划规定 n<10 只报计数，正文不对这些单元格作组间解释。",
    relatedCheckIds: [
      "analysis_fit.group_sample_feasibility",
      "sampling_recruitment.group_reach",
    ],
    expected: "not_flag",
    rationale:
      "计划已限制为计数且不解释小单元格差异，不能单凭 n=4 判严重缺陷；是否能回答完整研究问题须另审，n<10 也不是通用方法标准。",
  },
  {
    id: "edge.exact_experience_filter",
    title: "筛选完整覆盖追问经历",
    situation: "追问使用 ChatGPT 写文献综述的困难，仅在过去一学期确实使用 ChatGPT 写过文献综述者中展示，时间口径一致。",
    reviewQuestion: "此筛选是否已覆盖追问的工具、任务与时间前提？",
    relatedCheckIds: ["wording.presumptive"],
    expected: "not_flag",
    rationale: "工具、任务和时间匹配，不再以使用任意 AI 代替具体经历；仍可另外审查是否允许没有困难。",
  },
  {
    id: "edge.independent_objects",
    title: "两个独立评价对象共用答案",
    situation: "题干为你对实验课的设备维护和教师指导满意吗，只能在一个满意度刻度上回答。",
    reviewQuestion: "设备维护和教师指导能否独立评价，合并作答是否产生双重提问？",
    relatedCheckIds: ["wording.double_barrel"],
    expected: "flag",
    rationale: "设备维护与教师指导可以有不同评价，单个答案不能区分二者；与设备维护状况中的限定语不同。",
  },
  {
    id: "edge.self_written_agreement",
    title: "自拟同意度题不自动成为严重缺陷",
    situation: "自拟三题测量单一工作态度，采用非常不同意到非常同意五点刻度，没有提供试答或对照研究证据。",
    reviewQuestion: "能否只根据自拟题的同意度格式认定严重缺陷？",
    relatedCheckIds: ["wording.acquiescence"],
    expected: "not_flag",
    rationale: "同意度格式可提示默许风险，但自拟与格式本身不能证明严重失效，缺验证应与证伪分开。",
  },
];
