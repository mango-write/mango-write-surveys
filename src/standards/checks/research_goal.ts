import type { StandardsCheck } from "../schema.js";

// 研究目标维度：先确认「要回答什么、能不能回答」，再谈题目怎么写。
// 目标层缺陷会连带污染抽样、题量与分析，故多为阻断或严重级判断项。
export const researchGoalChecks: StandardsCheck[] = [
  {
    id: "research_goal.vague_objective",
    dimension: "research_goal",
    title: "目标不可操作",
    claim:
      "研究目标必须写成可判定的句子：指明目标人群、要测量的具体构念及其维度、时间或情境口径与产出用途。「了解大家的看法」「调研现状」这类没有构念、没有边界的表述不算目标，无法据此决定题目、样本与结论边界。",
    citations: [
      {
        source: "aapor",
        note: "Planning Your Survey：目标必须 unambiguous and specific，先写清要回答的问题再选方法",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；目标可由独立的设计说明承载，但必须与问卷题目一一对应，不能只存在于委托方口头描述中。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "设计文档他处已有可操作研究问题且问卷与之对齐时降 minor；只有口号式目标时保持 major。",
    },
    errorExample: {
      description: "目标写成口号式表述，没有任何可测量对象或人群边界。",
      snippet: "本问卷旨在了解大家对科研工具的看法，为改进科研支持提供参考。",
      why: "「看法」可以是态度、使用行为、需求或评价，设计者只能凭直觉选题；事后任何结果都能自称回答了目标，也无法判断哪些题是多余的。",
    },
    handling:
      "改写为「测量<人群>在<时间窗>内对<具体工具或场景>的<使用频率、障碍或满意度>分布，用于确定支持措施的优先项」，并补一句非目标（如「不解释因果」）。目标定不下来时先做文献梳理或访谈，不要先写题。",
  },
  {
    id: "research_goal.question_misalignment",
    dimension: "research_goal",
    title: "研究问题与问卷目标错位",
    claim:
      "研究问题问的是成因、机制、效果或组间差异时，问卷必须能产出对应变量与分析路径；只能产出分布与自评的问卷不得宣称回答「为什么」「是否有效」「谁更高」。目标与方法错位属于设计错误，分析阶段无法补救。",
    citations: [
      {
        source: "aapor",
        note: "Planning Your Survey：按研究问题选择方法，焦点小组、既有数据或实验设计可能比问卷更合适",
      },
      {
        source: "product",
        note: "research-data 当前只支持描述统计、分组与交叉表，无推断检验与效应量（docs/product/research-data.md）",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；错位判定以 research-types.ts 的 limitations 与 research-data 当前支持清单为准。",
    },
    classification: "judgment",
    severity: {
      level: "blocker",
      conditions:
        "研究问题已明确降级为描述性子问题（如把「是否提升」改为「自评能力的分布」）时降 major。",
    },
    errorExample: {
      description: "研究问题要判断培训是否提升能力，问卷只采一次自评能力与满意度。",
      snippet:
        "研究问题：参加培训是否提升了教师的科研能力？问卷题目：你对本次培训的满意度是？",
      why: "满意度与能力提升不是同一构念，且没有前后测或对照组；无论满意度多高都不能回答「是否提升」，结论必然越界。",
    },
    handling:
      "把研究问题改成可回答的描述性问题，或补充前后测与对照并说明非随机不能归因；当前系统不做推断检验，效果类问题须走外部设计。生成器遇到目标含「影响、提升、导致」时提示方法不匹配。",
  },
  {
    id: "research_goal.existing_data_first",
    dimension: "research_goal",
    title: "未先核查已有数据",
    claim:
      "设计新问卷前须核查已有统计、既往调查、平台日志与文献能否回答目标；重复采集同一人群的同一构念时，必须写出新增价值（新人群、新时效、新维度或更细分组），否则属于无必要的受访者负担。",
    citations: [
      {
        source: "aapor",
        note: "Planning Your Survey：先确认已有数据是否够用，不够再自行采集",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；核查结论应记录在设计说明中，供评审复核，不能只在研究者脑内完成。",
    },
    classification: "judgment",
    severity: {
      level: "minor",
      conditions:
        "重复采集敏感数据，或挤占同一人群短期内的调研资源时升 major。",
    },
    errorExample: {
      description: "已有公开年度统计覆盖的指标，仍发新问卷从头采集。",
      snippet: "为摸清本校研究生规模与分布，向全体研究生发放 20 题问卷。",
      why: "学籍数据本可回答规模与分布，问卷回收率低且口径可能与官方统计冲突；受访者付出时间却得不到新增信息。",
    },
    handling:
      "先列二手来源（官方统计、既往调查、系统日志）与它们的覆盖缺口，只对缺口设题。确需自采时，在研究说明中写清「已有数据不足」的具体理由与新增价值。",
  },
  {
    id: "research_goal.predetermined_conclusion",
    dimension: "research_goal",
    title: "为预定结论找数据",
    claim:
      "问卷不得以证明既定立场、支持宣传、募款或推销为目标，也不得把结论写进题干与选项；研究目标须保留结果可能否定假设的空间，分析口径在设计阶段冻结，不得看到数据后再挑结论。",
    citations: [
      {
        source: "aapor",
        note: "Planning Your Survey：问卷不得用于 predetermined results、campaigning、fundraising 或 selling；目标与措辞须中立",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；委托方指定结论的商业或宣传项目不属于研究性调查，应另行声明用途并停止使用研究表述。",
    },
    classification: "judgment",
    severity: {
      level: "blocker",
    },
    errorExample: {
      description: "目标直接写「证明课程有效」，问卷只保留正向评价入口。",
      snippet:
        "研究目标：证明本课程显著提升学生科研能力。题目：本课程对你的帮助有多大？〔很大/较大/一般〕",
      why: "没有「无帮助」与「变差」通道，也没有前后测；数据只能产出正向评价，结论是设计出来的而非测量出来的。",
    },
    handling:
      "把目标改成可证伪的中立表述并补齐对称选项；有前后测时预注册比较口径。委托方需要宣传材料时，与研究性调查分开，并在材料中标注非研究用途。",
  },
  {
    id: "research_goal.scope_creep",
    dimension: "research_goal",
    title: "单卷塞入多个不相关目标",
    claim:
      "一份问卷只承载一个主研究问题及其必要子问题；新增模块若对应不同人群、不同构念或不同决策用途，必须拆卷。目标过多会拉长问卷、稀释预测试深度，并使单一分析计划无法覆盖全部数据。",
    citations: [
      {
        source: "aapor",
        note: "Planning Your Survey：先明确单一调查目的；Designing your questionnaire：题目须服务研究问题",
      },
      {
        source: "product",
        note: "单卷题数 ≤50、页数 ≤20 的硬上限（docs/product/surveys.md）；上限内仍应受目标收敛约束",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；同人群、同构念且仅作背景补充的少量题目（≤3 题）不算多目标。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "模块共享同一人群与构念、仅补充背景且总题量仍低于负担阈值时降 minor。",
    },
    errorExample: {
      description:
        "一份问卷同时服务学生负担、教师培训需求与家长满意度三套决策，且三套人群不同。",
      snippet: "本问卷同时了解学生课业负担、教师培训需求与家长对学校的满意度。",
      why: "三类受访者对同一套题目没有共同含义，样本无法合并分析；每题都得不到足够的预测试与追问深度，结论只能各自半成品。",
    },
    handling:
      "按目标拆成独立问卷，各自定义人群与样本；确需同卷时只保留一个主目标，次目标题量受控且不进入主结论，并在分析计划中分开报告。",
  },
  {
    id: "research_goal.unobservable_construct",
    dimension: "research_goal",
    title: "目标构念无法由作答代理",
    claim:
      "目标中的每个构念必须能由问卷作答合理代理；真实能力、临床诊断、组织绩效、他人行为这类无法自填准确测量的构念，须换数据源或收窄目标，否则测到的是自评或印象，而不是构念本身。",
    citations: [
      {
        source: "aapor",
        note: "Planning Your Survey：按问题性质选择方法，焦点小组、观察或既有记录可能更合适",
      },
      {
        source: "cosmin",
        note: "内容效度 relevance 要素：题目必须真正对应目标构念（借自健康测量工具语境，构念-题目对应关系判据通用）",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；构念有公认自评量表且目标明确写成「自评」时不算违反，但报告中不得去掉「自评」限定。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "构念与题目偏差较小、仅作辅助描述且已在报告中限定解释范围时降 minor。",
    },
    errorExample: {
      description: "目标要评估导师指导质量，只让研究生给导师打分。",
      snippet: "研究目标：评估本系导师的指导质量。题目：请给你的导师打分（1-5 星）。",
      why: "打分混合了师生关系、怕被识别与个人打分习惯，无法区分指导行为与满意度；导师也无法被所有学生可靠观察，结果不能代表第三方评估。",
    },
    handling:
      "把目标收窄为「研究生对导师指导的满意度自评」并写明局限；需要客观质量时改用指导记录、成果产出或同行评审等外部数据。匿名无法保证时，不要用匿名承诺换取坦诚作答。",
  },
];
