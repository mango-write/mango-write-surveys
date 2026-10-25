import type { StandardsCheck } from "../schema.js";

// 表述维度：题目措辞是否让所有受访者按同一含义理解、按同一口径作答。
// 全部为 judgment 级：规则引擎不可靠，AI 审查出候选，最终由预测试或专家确认。
export const wordingChecks: StandardsCheck[] = [
  {
    id: "wording.double_barrel",
    dimension: "wording",
    title: "双重提问",
    claim:
      "一道题只问一件事：题干不得把两个可独立回答的对象（并列名词、并列动词、主句+从句评价）压进同一次作答，受访者无法对「整体」给出可解释的答案。",
    citations: [
      {
        source: "pew",
        note: "Question wording 节：avoiding double-barreled questions（一次问一件事，并列概念拆成两题）",
      },
      {
        source: "aapor",
        note: "Designing your questionnaire：questions should address one concept at a time",
      },
    ],
    appliesTo: {
      notes: "适用于一切提问型题目（含矩阵行、多项填空项）；说明块（statement）不是题目，不适用。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "其中一个词只是另一评价对象的限定说明、无法独立作答时，不构成双重提问，不报本项。",
    },
    errorExample: {
      description: "单选题把「课程内容」与「授课教师」两个评价对象并列。",
      snippet: "你对本课程的内容和授课教师满意吗？",
      why: "内容满意但教师不满意的受访者无诚实选项：选「满意」谎报内容，选「不满意」冤枉教师，两个构念的测量都失真，且结果无法拆分归因。",
    },
    handling:
      "拆成两道独立题目分别作答；矩阵题把并列对象拆为不同行。生成器遇到并列结构应主动提示拆分，诊断器给出建议拆分文案。",
  },
  {
    id: "wording.leading",
    dimension: "wording",
    title: "诱导与情绪化措辞",
    claim:
      "题干与选项不得使用带立场的形容、比喻、权威背书或情绪化标签引导特定作答方向；中立措辞是测量的前提。",
    citations: [
      {
        source: "pew",
        note: "Question wording 节：avoiding biased or emotionally loaded words（welfare vs assistance to the poor 的对比）",
      },
      {
        source: "aapor",
        note: "Designing your questionnaire：avoid biased or leading language",
      },
    ],
    appliesTo: {
      notes: "适用于题干、选项文案与页说明；量表两端文案同样不得单侧加码。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "诱导来自与研究无关的装饰性形容（不影响作答方向）时降 minor。",
    },
    errorExample: {
      description: "题干预设了「加班有害」的立场再问频率。",
      snippet: "你认为危害健康的加班文化在你单位有多严重？",
      why: "「危害健康」把结论写进了问题，不认同前提的受访者被迫在诱导框架内作答，测出来的是对框架的顺从而非真实态度。",
    },
    handling:
      "删去立场词改中性表述（「你认为你单位的加班情况如何」）；选项文案成对平衡（满意/不满意），量表两端对称。诊断时给出中性化改写建议。",
  },
  {
    id: "wording.vague_terms",
    dimension: "wording",
    title: "含糊用语与未定义术语",
    claim:
      "题干中的关键名词、术语、缩写必须有目标人群共识的含义：不得使用行话、未展开缩写、指代不明的「他们/这种情况」，量化词（经常、大量）不得无锚点使用。",
    citations: [
      {
        source: "pew",
        note: "Question wording 节：simple, concrete language——avoid jargon and abbreviations, consider the population's education level",
      },
      {
        source: "cdc_cognitive",
        note: "作答复核模型 comprehension 过程：术语在受访者间含义不一致是首要测量误差来源",
      },
      {
        source: "cosmin",
        note: "内容效度 comprehensibility 要素（借自健康测量工具语境，术语可理解性判据通用）",
      },
    ],
    appliesTo: {
      notes: "适用于一切提问型题目；判定基准是「目标人群」（见 sampling_recruitment 维度的人群定义），不是研究者自己。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "术语在题干或说明中已有明确定义时不算违反；量化词带明确定义锚点（每周 ≥3 次）时不算违反。",
    },
    errorExample: {
      description: "面向非专业人群的问卷直接使用领域缩写。",
      snippet: "你平时使用 LLM 辅助文献综述的频率是？",
      why: "不知道缩写的受访者要么乱选要么退出，「经常使用」的分子里混进了猜测作答；不同理解口径下的频次不可比。",
    },
    handling:
      "首次出现时用一句话定义术语或改用日常语言；量化频率词改为带锚点的时间段表述。不确定目标人群是否理解时列入预测试认知访谈重点。",
  },
  {
    id: "wording.timeframe",
    dimension: "wording",
    title: "时间参照缺失或不一致",
    claim:
      "询问行为、经历、状态的题目必须带明确时间参照（回忆期），且参照口径在同一研究内一致；缺失时间参照的频率/数量题不可比。",
    citations: [
      {
        source: "pew",
        note: "Question wording 节：clarity and specificity——every respondent must be able to answer 同一口径",
      },
      {
        source: "cdc_cognitive",
        note: "recall 过程：回忆期越长、事件越密集，遗漏与压缩越严重，口径不一致直接破坏可比性",
      },
    ],
    appliesTo: {
      notes: "适用于询问行为频率、事件次数、状态持续的题目；测量稳定特质（如性格自评）的题目不需要回忆期，不适用。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "研究说明已统一声明全卷时间口径、题目未写也不产生歧义时降 minor。",
    },
    errorExample: {
      description: "频率题没有任何时间参照。",
      snippet: "你参加学术讲座的频率是？〔从不/偶尔/经常/总是〕",
      why: "「经常」有人按学期、有人按周理解，作答分布不可比；与带回忆期的其他行为题交叉时口径错位。",
    },
    handling:
      "补明确回忆期（过去一学期内）；同卷行为题统一时间口径并在研究说明声明。回忆期超过一个月的密集事件考虑改为「过去一周」或分段回忆。",
  },
  {
    id: "wording.double_negative",
    dimension: "wording",
    title: "双重否定",
    claim:
      "题干与选项不得叠加否定使真实含义需要二次翻转才能理解；单次否定必须醒目且无歧义。",
    citations: [
      {
        source: "pew",
        note: "Question wording 节：avoid double negatives",
      },
      {
        source: "cdc_cognitive",
        note: "comprehension 过程：否定翻转加重理解负担，自填场景尤甚",
      },
    ],
    appliesTo: {
      notes: "适用于题干与选项文案；矩阵行陈述同样适用。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "单一否定且否定词紧邻被否定对象（无翻转歧义）时不算违反。",
    },
    errorExample: {
      description: "同意度矩阵行叠加两层否定。",
      snippet: "你不认为导师没有义务逐句修改你的论文。〔非常不同意…非常同意〕",
      why: "受访者需要算两次「不」才能还原句义，作答极易翻转；该行数据几乎不可用。",
    },
    handling: "简化否定，保留原本要测量的含义；反向计分由构念方向与计分规则决定，不以翻转显示刻度替代，也不擅改既有量表。",
  },
  {
    id: "wording.acquiescence",
    dimension: "wording",
    title: "同意度格式的默许风险",
    claim:
      "同意度格式可能受到默许倾向影响，应结合陈述方向、目标人群和测量目的评估是否改为直接评价；仅凭使用同意度格式，不能认定题目无效或存在严重缺陷。",
    citations: [
      {
        source: "pew",
        note: "Question wording：同意度格式可能产生 acquiescence bias；据此检查风险，不推导所有态度题禁用同意度格式。",
      },
    ],
    appliesTo: {
      questionTypes: ["matrix_single", "scale"],
      notes: "仅当行/题干是态度陈述、选项是同意度刻度时命中；事实性矩阵（如「你在哪些场所使用过」）不适用。",
    },
    classification: "judgment",
    severity: {
      level: "minor",
      conditions: "仅提供格式改进建议，不因自拟题自动升 major；有适用证据的既有量表不为规避格式风险而擅改。声称沿用但缺可核验来源时，记录来源证据不足，不视为已验证。",
    },
    errorExample: {
      description: "自拟态度题使用同意度刻度，需要评估默许风险。",
      snippet: "我擅长使用新工具。〔非常不同意…非常同意〕",
      why: "可能出现与内容无关的同意倾向，但风险是否实际损害测量需要证据；直接自评能力也不是对原题的当然等价替代。",
    },
    handling:
      "将直接评价作为候选方案，先核对是否仍测量同一概念，再通过试答比较；既有量表保留适用版本与来源，不仅为格式偏好改写。",
  },
  {
    id: "wording.presumptive",
    dimension: "wording",
    title: "预设前提",
    claim:
      "题目不得预设受访者具有某经历、身份或立场后再追问细节（「家妻打你吗」式）；预设错误时受访者只能编造或退出，产生假数据。",
    citations: [
      {
        source: "pew",
        note: "Question wording 节：biased or loaded wording 与 clarity——题目必须对全部受访者可作答",
      },
      {
        source: "cdc_cognitive",
        note: "comprehension/response 过程：受访者对不成立的预设倾向于选最近似选项而非指出前提错误",
      },
    ],
    appliesTo: {
      notes: "适用于一切提问型题目；对可能有「无此经历」人群的题目，前提必须先经筛选题确认。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "前提已由前面的筛选题保证（showIf 条件覆盖）时不适用。",
    },
    errorExample: {
      description: "未筛选直接追问使用体验。",
      snippet: "你使用 ChatGPT 写文献综述时遇到的主要困难是什么？",
      why: "没用过的受访者被迫在困难选项里挑一个，困难分布里混入大量编造作答。",
    },
    handling:
      "前置筛选题（是否使用过）并用显示条件只向有经历者追问；筛选题必须含「从未使用」选项且不得必答错误。生成器产出追问链时应自动配筛选题。",
  },
  {
    id: "wording.social_desirability",
    dimension: "wording",
    title: "敏感题社会期许",
    claim:
      "敏感或具有社会评价压力的话题可能存在社会期许偏差，应评估匿名、拒答路径与中性表述；直陈式提问不自动证明严重偏差，间接提问也不是普遍更优的替代。",
    citations: [
      {
        source: "pew",
        note: "Question wording 节：social desirability bias（understate drug use, overstate voting/church attendance）——word questions to make honest answers easier",
      },
      {
        source: "aapor",
        note: "Designing your questionnaire：protect respondents——confidentiality practices, skip options, resources for sensitive topics",
      },
    ],
    appliesTo: {
      notes: "仅敏感话题题目命中；是否敏感由话题性质与目标人群共同决定（同一问题对不同人群敏感度不同）。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "仅发现敏感主题时记录风险或待验证；结合强迫回答、识别风险或实测证据判断严重性，不只按主题定 major。已有匿名和拒答措施也不代表风险必然消除。",
    },
    errorExample: {
      description: "直陈式问学术不端行为且必答。",
      snippet: "你抄袭过别人的论文吗？〔是/否〕（必答）",
      why: "敏感经历与必答组合可能促使拒答、退出或隐瞒，但不能未实测就给出偏差幅度或断言否认率。",
    },
    handling:
      "保留测量本人行为的目标，提供可信保密说明、中性措辞和拒答路径；询问周围同学会改变测量对象，不能当作等价修复。间接方法须另行设计并验证。",
  },
];
