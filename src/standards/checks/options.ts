import type { StandardsCheck } from "../schema.js";

// 选项维度：选项集是否穷尽、互斥、刻度可信，能否支撑可解释的作答与归因。
// rule 级条目（重复文案、exclusive 配置）可程序判定，其余由 AI 审查出候选、预测试或专家确认。
export const optionsChecks: StandardsCheck[] = [
  {
    id: "options.not_exhaustive",
    dimension: "options",
    title: "选项集不穷尽",
    claim:
      "封闭式选项集必须穷尽：凡可能存在「其他情况/不适用/无法回答」的题目，必须提供相应出口选项或明确的开放补充；没有出口时对不上选项的受访者只能乱选或退出，测到的分布被无应答结构污染。",
    citations: [
      {
        source: "pew",
        note: "Open- and closed-ended questions 节：选项须穷尽（exhaustive）——每个受访者都要有符合自己情况的选项",
      },
      {
        source: "cdc_cognitive",
        note: "response 过程：选项里找不到符合自己情况的答案时，受访者选最近似项而非放弃，误差静默进入数据",
      },
    ],
    appliesTo: {
      questionTypes: [
        "single",
        "multiple",
        "image_single",
        "image_multiple",
        "dropdown",
        "ranking",
      ],
      notes: "适用于封闭选项题；选项集可自然穷举（性别、年级）且经确认无遗漏时可不设出口。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "筛选题已限定人群（仅问有经历者）时降 minor；可穷举分类无出口不算违反，但须在研究说明写明覆盖口径。",
    },
    errorExample: {
      description: "学位题漏掉非典型学位类型。",
      snippet: "你攻读的是哪类学位？〔学术硕士/专业硕士/博士〕",
      why: "同等学力、本科直博、联合培养学位的受访者无出口，只能挑一个最近的选项，学位分布里混入错分类。",
    },
    handling:
      "补「其他（请注明）」出口或配开放补充项；确系可穷举分类时在研究说明写明覆盖范围，生成器对新增选项题提示穷举核对。",
  },
  {
    id: "options.overlapping",
    dimension: "options",
    title: "选项边界重叠",
    claim:
      "选项边界必须互斥：任何两个选项的语义域不得重叠；重叠使单选受访者的选择不可归因（多个选项同时成立），多选频次重复计数，分组比较的口径随之失真。",
    citations: [
      {
        source: "pew",
        note: "Open- and closed-ended questions 节：选项须互斥（mutually exclusive）——边界重叠使选择不可归因",
      },
      {
        source: "aapor",
        note: "Designing your questionnaire：选项互斥且完备，是封闭题可分析的前提",
      },
    ],
    appliesTo: {
      questionTypes: ["single", "multiple", "dropdown", "ranking", "matrix_single"],
      notes: "适用于一切封闭选项题；时间/程度刻度出现层级包含（「经常」吞掉「每周多次」）时同样命中。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "设计意图即「选所有符合项」且与研究问题匹配时不算违反；重叠仅在边缘选项（如「其他」）且不影响主要比较口径时降 minor。",
    },
    errorExample: {
      description: "分类维度混用，选项互相包含。",
      snippet: "你的年级是？〔大一/大二/本科生/研究生〕",
      why: "大一学生同时符合「大一」与「本科生」两个选项，选哪个取决于选项位置而非事实，年级分布重复计数且无法拆分归因。",
    },
    handling:
      "按单一维度重划边界（只按年级展开，或只按培养层次展开）；确需多属性分类时拆成两道题。诊断时给出重划后的选项集建议。",
  },
  {
    id: "options.duplicate_labels",
    dimension: "options",
    title: "选项文案重复",
    claim:
      "同一题的选项文案不得重复（归一化去空白与全半角差异后相同）：重复选项在单选下无法区分选中项，在多选下重复计数，导出变量字典时同 label 无法归位。",
    citations: [
      {
        source: "aapor",
        note: "Designing your questionnaire：选项须互斥且可分辨——重复文案使选项集失去互斥性",
      },
      {
        source: "product",
        note: "系统能力：选项 id 进变量字典、label 是展示键——重复 label 使导出与统计无法按选项归位",
      },
    ],
    appliesTo: {
      questionTypes: [
        "single",
        "multiple",
        "image_single",
        "image_multiple",
        "dropdown",
        "ranking",
        "scale",
      ],
      notes: "程序判定：选项 label 归一化后两两比对；量表刻度档重复同样命中。",
    },
    classification: "rule",
    severity: {
      level: "major",
      conditions: "重复是两个选项本应不同却误填相同文案（修复即消除）时降 minor；图片题的图不同但文案相同仍算重复。",
    },
    errorExample: {
      description: "同意度量表中两档文案误填相同。",
      snippet: "〔同意/基本同意/基本同意/不同意〕",
      why: "受访者选第二个「基本同意」时无法知道对应哪个选项 id，频次统计与导出双双错位，该题数据不可用。",
    },
    handling:
      "删除或改写重复项；两选项本意不同时补齐区分锚点（程度、时间）。规则引擎直接报「选项文案重复」，生成器阻止同 label 选项入库。",
  },
  {
    id: "options.scale_balance",
    dimension: "options",
    title: "量表正负不对称",
    claim:
      "含正负向的评价刻度必须正负对称：一侧堆砌档位（三个负向档对一个正向档）时，受访者把不同程度压进档少的一侧，均值与分布系统性偏离真实态度。",
    citations: [
      {
        source: "pew",
        note: "量表设计主题：response scales 应正负对称（balanced scales）——一侧多档使回答分布偏移",
      },
      {
        source: "cdc_cognitive",
        note: "judgment 过程：档位宽度不均时受访者把不同程度归入同一档，区分度丢失",
      },
    ],
    appliesTo: {
      questionTypes: ["scale", "rating", "matrix_single"],
      notes: "仅针对含正负向的评价刻度；单向累积刻度（频率、重要性从低到高）不要求正负对称，但档距语义须等宽。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "沿用已验证量表的原始刻度时不算违反（改编须记录来源）；有意设计的单向刻度降 minor。",
    },
    errorExample: {
      description: "满意度刻度负向三档、正向一档。",
      snippet: "服务质量：〔很不满意/不满意/比较不满意/满意〕",
      why: "「不太满意」与「一般」都被压进「比较不满意」，负向人数虚高，均值的正负方向不可解释。",
    },
    handling:
      "补齐对称档位（「很不满意/不满意/一般/满意/很满意」）或改用语意等宽的单向刻度；生成器提供对称模板，诊断器给出缺档提示。",
  },
  {
    id: "options.forced_choice",
    dimension: "options",
    title: "选项格式与信息目标错配",
    claim:
      "选择格式须与分析目标一致：多选只说明选中了哪些，不能直接给出唯一首选或完整排序；逐项是/否、单选首选和排序回答不同问题，不能互相等同。",
    citations: [
      {
        source: "pew",
        note: "Open- and closed-ended questions 及其 2019 格式研究：forced-choice 指逐项明确是/否，不是整题只选一项；格式影响选中率，排序研究并非一律禁用多选。",
      },
    ],
    appliesTo: {
      questionTypes: ["multiple", "image_multiple"],
      notes: "仅当研究问题是「最主要/排序」类时命中；研究问题就是「符合项集合」时多选是正确设计，不适用。",
    },
    classification: "judgment",
    severity: {
      level: "minor",
      conditions: "研究问题确为「符合项有哪些」时不适用；maxChoices=1 的多选等价单选，不构成 select-all。",
    },
    errorExample: {
      description: "问「最影响」却开放多选。",
      snippet: "哪些因素最影响你的选题？（可多选）〔导师建议/经费/兴趣/前沿性/…〕",
      why: "此处若要获取每个人的唯一首选，多选答案不足以恢复个人排序；若只描述人群中的选中率，则可保留多选并按实际格式解释。",
    },
    handling:
      "需要唯一首选时追加单选，需要顺序时用排序；需逐项判断是否符合时可逐项是/否。保留多选时按符合项集合解释，不把选中率直接称为个人优先级。",
  },
  {
    id: "options.exclusive_semantics",
    dimension: "options",
    title: "互斥项配置矛盾",
    claim:
      "多选题的 exclusive 互斥项必须与数量约束自洽：单选题选项标 exclusive 属无效配置；minChoices>1 时任何 exclusive 项都不可达（选了它就无法满足数量下限），二者矛盾必有一方错误。",
    citations: [
      {
        source: "product",
        note: "系统能力：exclusive 只定义在 multiple/image_multiple 的选项上，与 minChoices/maxChoices 的组合可达性可静态校验",
      },
      {
        source: "aapor",
        note: "Designing your questionnaire：互斥选项（如「以上皆非」）用于保护数据边界，配置须与数量约束一致",
      },
    ],
    appliesTo: {
      questionTypes: ["multiple", "image_multiple", "single", "image_single"],
      notes: "程序判定两项：单选题选项带 exclusive（无效配置）；exclusive 项与 minChoices/maxChoices 组合后无可选路径。",
    },
    classification: "rule",
    severity: {
      level: "major",
      conditions: "minChoices=0 或 1 时不构成矛盾；单选题残留的 exclusive 属编辑器可清理的存量配置，降 minor。",
    },
    errorExample: {
      description: "强制选 2 项却配了「以上皆非」互斥项。",
      snippet: "你最常使用的两类工具是？（至少选 2 项）〔A/B/C/以上皆非(exclusive)〕",
      why: "选「以上皆非」即无法再选第二项，必答约束下受访者被迫虚报一项工具，互斥项形同虚设还污染了频次。",
    },
    handling:
      "删除 exclusive 标记或把数量约束降为任选；规则引擎校验 exclusive 与数量约束的组合可达性，生成器配置互斥项时提示同步数量约束。",
  },
  {
    id: "options.frequency_anchors",
    dimension: "options",
    title: "频度档锚点混乱",
    claim:
      "频次/程度选项必须使用单一锚点体系且档位单调等距：不得把时间锚定档（每周≥3 次）与模糊档（经常）混在同一选项集；档位顺序必须与题干度量方向一致。",
    citations: [
      {
        source: "cdc_cognitive",
        note: "response 过程：锚点体系不一致时受访者按各自理解归入不同档，频次分布不可比",
      },
      {
        source: "pew",
        note: "Question wording 节：量化频率词须有明确定义锚点，否则同一词多种理解",
      },
    ],
    appliesTo: {
      questionTypes: ["single", "dropdown", "scale", "rating", "matrix_single"],
      notes: "频度、程度、同意度量表都命中；全卷选项体系统一为时间锚定或统一模糊档并在卷首定义。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "选项全为模糊档但题干或研究说明已给出定义（「经常=每周≥3 次」）时降 minor；档位顺序与度量方向颠倒时数据不可用，升 blocker。",
    },
    errorExample: {
      description: "时间档与模糊档混排。",
      snippet: "你多久去一次图书馆？〔每周多次/每月一次/经常/从不〕",
      why: "「经常」无锚点，有人按周理解有人按月；与「每月一次」并排时排序也失去意义，频次分布不可比。",
    },
    handling:
      "全选项统一改为时间锚定档（每周多次/每周一次/每月数次/很少或从不）或统一模糊档加卷首定义；档位按度量方向单调排列。",
  },
  {
    id: "options.order_rotation",
    dimension: "options",
    title: "选项顺序未轮换",
    claim:
      "无序选项集（非刻度）应轮换或随机化呈现顺序以抵消首因/近因顺序效应；有序量表（刻度、同意度）不得轮换，轮换会破坏刻度语义。",
    citations: [
      {
        source: "pew",
        note: "Open- and closed-ended questions 节：轮换/翻转选项顺序抵消 order effects；有序量表不轮换",
      },
    ],
    appliesTo: {
      questionTypes: ["single", "multiple", "image_single", "image_multiple", "dropdown"],
      notes: "仅无序选项集命中轮换要求；scale/rating/matrix_* 刻度题不适用。系统无选项级随机化时至少固定顺序并在研究说明记录口径。",
    },
    classification: "judgment",
    severity: {
      level: "minor",
      conditions: "选项集本身有序（如教育程度从低到高）时不轮换不算违反；单卷内比较且顺序全卷固定时降 minor 并记录。",
    },
    errorExample: {
      description: "十个品牌的偏好单选，全部受访同一顺序。",
      snippet: "你最偏好哪个品牌？〔A/B/C/D/E/F/G/H/I/J〕（固定顺序）",
      why: "首因效应下靠前选项系统性高选，选中率里混入顺序成分；与选项顺序不同的其他题比较时偏差方向还不一致。",
    },
    handling:
      "用系统的轮换/随机化配置打散顺序；无随机化能力时固定同一顺序并保持跨卷一致，在报告说明顺序口径。",
  },
];
