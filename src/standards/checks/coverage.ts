import type { StandardsCheck } from "../schema.js";

// 测量覆盖维度：构念是否被完整、相关且可理解地测量（cosmin 内容效度三要素
// 在本仓的落地）。以判断为主；「目标人群是否真理解」只能由真人验证。
export const coverageChecks: StandardsCheck[] = [
  {
    id: "coverage.construct_dimensions",
    dimension: "coverage",
    title: "构念维度缺失",
    claim:
      "每个研究构念在设计阶段须列出其理论或工作定义下的全部维度，并保证每个维度都有题目承载。缺失某维度却以构念整体名义下结论，会让结果只覆盖构念的一部分，且缺失部分无法从数据反推。",
    citations: [
      {
        source: "cosmin",
        note: "内容效度 comprehensiveness：题目须覆盖构念全域、不缺维度（借自健康测量工具语境，构念覆盖判据通用）",
      },
      {
        source: "aapor",
        note: "Designing your questionnaire：题目设计须与研究问题的各个组成部分对应",
      },
    ],
    appliesTo: {
      notes:
        "适用于含明确构念的研究（现状调查的核心指标、群体比较的比较变量、态度量表的各维度）；单一事实性题目不适用。",
    },
    classification: "judgment",
    severity: {
      level: "blocker",
      conditions:
        "缺失维度在报告中明确排除、结论也只限定到已覆盖维度时降 major。",
    },
    errorExample: {
      description: "把「科研能力」缩成发表数量，其他维度整体缺席。",
      snippet: "科研能力调查：过去三年你发表了几篇论文？〔0/1-2/3-5/6 篇以上〕",
      why: "科研能力还包含问题提出、方法设计、协作与伦理等维度；只测发表量时，「能力提升」实际是「发文增多」，缺失维度无法通过分析补回。",
    },
    handling:
      "先写「构念→维度→题目」覆盖矩阵，逐维度检查有无题目；缺维度就补题，补不了就把结论收窄到已覆盖维度，并在研究说明里列出未覆盖部分。",
  },
  {
    id: "coverage.item_relevance",
    dimension: "coverage",
    title: "题目与构念无关",
    claim:
      "每道题必须能指向目标构念的具体维度，并能解释它将进入哪项分析。与研究问题无关的「顺便了解一下」题应删除：它增加负担、稀释测量密度，还会在分析时诱发无计划的比较。",
    citations: [
      {
        source: "cosmin",
        note: "内容效度 relevance：题目必须与目标构念及目标人群相关（借自健康测量工具语境，相关性命中与无关题剔除判据通用）",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切提问型题目；被明确当作混杂变量的题目不算无关，但必须能说出它要解释哪个关系（见 coverage.unmeasured_confounder）。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "无关题仅 1 题且明确标注为背景、不进入分析时降 minor。",
    },
    errorExample: {
      description: "满意度问卷夹入与构念无关的通勤信息。",
      snippet: "你平时主要采用哪种通勤方式？〔步行/骑行/公交/自驾/其他〕",
      why: "通勤方式不进入满意度构念，也不在分析计划里；它会增加无应答与中途退出，还容易被事后拿来做事后比较，放大偶然发现。",
    },
    handling:
      "建题目-构念映射表，没有归属的题删除或移出研究问卷。若题目用于解释混杂，须在研究说明与分析计划中写明它解释哪个关系，并保证分析阶段真的使用。",
  },
  {
    id: "coverage.items_per_dimension",
    dimension: "coverage",
    title: "单维度题量不足",
    claim:
      "拟合成维度得分时，应说明题项为何覆盖目标内容、如何计分及依据何在；不能仅凭题数判定内容效度。单题不能估计内部一致性，但单题或短量表是否适用须结合构念、用途与验证证据。",
    citations: [
      {
        source: "cosmin",
        note: "内容效度 comprehensiveness 与 relevance 关注覆盖与相关性（借自健康测量工具语境），不据此推出每维至少三题的通用数量要求。",
      },
    ],
    appliesTo: {
      researchTypes: ["attitude_scale"],
      notes:
        "适用于拟合成得分的态度测量；事实性单指标、已有适用证据的单题或短量表不能仅因题数少而判违规。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "单题描述且结论与用途一致时不报；仅缺验证证据时标为待验证，不把缺证据解释为已证实无效。",
    },
    errorExample: {
      description: "仅给单题作答，却声称已经验证多题内部一致性。",
      snippet: "仅一题：我经常全身心投入工作。分析计划：据该题计算内部一致性，证明整个工作投入量表可靠。",
      why: "单题不能估计多题内部一致性，也不能凭一个答案验证整个构念；问题是推断超出证据，不是单题本身必然无效。",
    },
    handling:
      "核对内容覆盖与计分依据，必要时增补互补题项；不能为凑题数添加不同构念。采用单题时明确报告含义与验证局限，不计算内部一致性。",
  },
  {
    id: "coverage.redundant_items",
    dimension: "coverage",
    title: "同维度题目近重复",
    claim:
      "同一维度内的题目不得只换同义词重复同一问法。冗余题会人为抬高内部一致性、加重作答负担，却不增加构念覆盖；判断标准是两道题能否给出不同信息（不同表现、情境或方向）。",
    citations: [
      {
        source: "cosmin",
        note: "内容效度 comprehensiveness 不等于题量堆叠：重复题不扩大覆盖（借自健康测量工具语境）",
      },
    ],
    appliesTo: {
      researchTypes: ["attitude_scale"],
      notes:
        "适用于多题测量同一维度的量表；事实性重复（同一指标的前后测）若为设计需要可保留，但须在分析计划中说明用途。",
    },
    classification: "judgment",
    severity: {
      level: "minor",
      conditions:
        "重复题占该维度一半以上、导致维度得分实际由同一句话决定时升 major。",
    },
    errorExample: {
      description: "三道题只替换「喜欢/乐于/感兴趣」，问的是同一件事。",
      snippet:
        "我喜欢使用新工具。／我乐于尝试新工具。／我对新工具感兴趣。〔非常不同意…非常同意〕",
      why: "受访者对三题调用同一段记忆与同一判断，答案高度雷同；合成后 α 虚高，但维度的内容覆盖没有增加，测量精度也没有实质提升。",
    },
    handling:
      "保留语义差异最大的题，其余按不同侧面重写（实际使用频率、遇到困难时的坚持、向他人推荐的意愿）；改写后检查两题能否产出不同信息，否则删除。",
  },
  {
    id: "coverage.missing_group_variable",
    dimension: "coverage",
    title: "比较研究缺分组变量",
    claim:
      "群体比较必须在问卷中采集至少一个能唯一划分子组的分组变量，且选项穷尽、每人只归一组。缺少分组变量时，采集后无法还原比较组，研究问题在分析阶段直接失效。",
    citations: [
      {
        source: "product",
        note: "research-data 的分组描述与交叉表以问卷内分组变量为前提，采集后无法补变量（docs/product/research-data.md）",
      },
      {
        source: "aapor",
        note: "Designing Your Sample：比较的子群须在样本设计中定义并可识别",
      },
    ],
    appliesTo: {
      researchTypes: ["group_comparison"],
      notes:
        "适用于以组间差异为核心问题的群体比较；分组变量可以是既有身份（学位类型、年级），也可以是研究设计变量（是否参加过项目）。",
    },
    classification: "rule",
    severity: {
      level: "blocker",
      conditions:
        "分组变量存在但选项不互斥或缺失处理未定义时降 major（仍可在采集前修复）。",
    },
    errorExample: {
      description: "目标是专硕与学硕比较，问卷里只有年级没有学位类型。",
      snippet:
        "研究目标：比较专硕与学硕的实习负担。题目：你目前的年级是？〔研一/研二/研三〕",
      why: "年级无法还原学位类型，交叉表没有分组的分子分母；事后用年级近似会改变研究问题，且多数年级同时含两类学生。",
    },
    handling:
      "加入单选分组变量（含「其他」与「不愿透露」），选项互斥且穷尽，并与纳入标准一致；分组变量设为必答或预先定义缺失处理，并进入变量字典。",
  },
  {
    id: "coverage.unmeasured_confounder",
    dimension: "coverage",
    title: "关键混杂变量未采集",
    claim:
      "群体比较或态度研究须采集能解释组间差异的主要替代变量（如使用经历、年级、资源条件），否则观察到的差异无法与选择偏差区分。混杂变量应少而准，每条都要写清它解释哪个关系。",
    citations: [
      {
        source: "aapor",
        note: "Analyzing and reporting your survey：子群差异须交代构成差异与局限，不能把描述差异当因果",
      },
      {
        source: "product",
        note: "research-data 无回归与统计控制，混杂变量只能做分层描述（docs/product/research-data.md）",
      },
    ],
    appliesTo: {
      researchTypes: ["group_comparison", "attitude_scale"],
      notes:
        "适用于比较组间差异或比较使用者与非使用者的研究；纯描述性现状调查若不做组间解释，可只保留与分层报告直接相关的变量。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "研究问题仅描述单组、不做任何组间比较时降 minor；差异被表述为因果时升 blocker。",
    },
    errorExample: {
      description: "比较用过与没用过 AI 的学生，却不采使用深度与资源条件。",
      snippet: "你是否使用过 AI 工具？〔是/否〕 你的科研产出效率如何？〔1-5〕",
      why: "使用者可能本就更高效或更有资源，效率差异无法区分是工具作用还是选择效应；只用「是否使用」二分还会把浅用与深度使用混在一起。",
    },
    handling:
      "列出 2-3 个理论上最重要的替代解释变量并纳入问卷（使用频率/深度、年级、项目资源）；分析计划写明只做分层描述、不做统计控制，报告中避免「导致」「提升」等因果措辞。",
  },
  {
    id: "coverage.comprehension_pretest",
    dimension: "coverage",
    title: "题目可理解性未经真人核实",
    claim:
      "目标人群是否按预期理解题目与刻度，需要认知访谈、预测试或适用的既有证据支持；缺少此类证据表示可理解性尚未验证，不能直接断言内容效度不成立。",
    citations: [
      {
        source: "cdc_cognitive",
        note: "作答复核模型四过程；目的抽样 20-50 人用于找问题而非估计总体",
      },
      {
        source: "cosmin",
        note: "内容效度 comprehensibility：目标人群可理解性须经目标人群验证（借自健康测量工具语境）",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；题目越抽象、人群与研究者语言差距越大，本条越关键。认知访谈记录应作为设计证据保留。",
    },
    classification: "human_data",
    severity: {
      level: "major",
      conditions:
        "仅做内部低风险反馈、不做对外结论时降 minor；对外发布且涉及敏感或专业术语时保持 major。",
    },
    errorExample: {
      description: "研究者认为术语清楚，未做任何目标人群试答就发布。",
      snippet: "请评价你在科研工作中的自我效能感与元认知调节水平。",
      why: "理解偏差不会在数据里显形，只会表现为高缺失、答案扎堆或前后矛盾；没有真人试答就无法区分「态度中立」与「没看懂」。",
    },
    handling:
      "按研究目的与关键子群组织认知访谈，逐题询问理解和作答过程并迭代修订；CDC 的常见样本规模不是所有项目的硬门槛。保留访谈笔记，认知访谈与流程试调查分别报告。",
  },
];
