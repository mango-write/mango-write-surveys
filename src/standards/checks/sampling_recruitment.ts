import type { StandardsCheck } from "../schema.js";

// 人群与招募维度：确认「谁在被研究、怎么找到他们、样本能说到哪」。
// 人群边界与招募渠道直接决定结论外推范围；语言与弱势群体条目只能靠真人核实。
export const samplingRecruitmentChecks: StandardsCheck[] = [
  {
    id: "sampling_recruitment.population_undefined",
    dimension: "sampling_recruitment",
    title: "目标人群定义不可操作",
    claim:
      "目标人群必须给出可判定的纳入边界：身份、地域、机构类型、时间窗与所处阶段至少覆盖到能被筛选题检验的程度。「广大科研工作者」「高校师生」这类无边界表述既建不出抽样框，也无法判断样本偏离。",
    citations: [
      {
        source: "aapor",
        note: "Designing Your Sample：先定义 target population 与 sampling frame，样本覆盖与无应答才有判断基准",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；目标人群写在设计说明或问卷说明中均可，但必须与筛选题和报告口径一致。",
    },
    classification: "judgment",
    severity: {
      level: "blocker",
      conditions:
        "仅做内部探索且报告明确只描述答卷者时降 major；对外发布结论时保持 blocker。",
    },
    errorExample: {
      description: "目标人群只有身份标签，没有机构、阶段与时间边界。",
      snippet: "本问卷面向广大科研工作者，了解大家的科研工具使用情况。",
      why: "「科研工作者」可能包含本科生、企业研发与退休人员，招募无法判断谁符合条件，回收样本与目标人群的偏差也无从估计。",
    },
    handling:
      "写成一句可判定的纳入标准（如「2025-2026 学年在境内高校任教的助理教授及以上，过去 12 个月主持过纵向项目」），并把不符合者做成筛选题退出；排除条件另列。",
  },
  {
    id: "sampling_recruitment.channel_bias",
    dimension: "sampling_recruitment",
    title: "招募渠道与人群不匹配",
    claim:
      "招募渠道必须能覆盖目标人群的主要异质构成。只在单一活跃社群、自组织群或机构内部转发，会同时产生活力偏差与自选偏差；设计须列出渠道清单、各渠道覆盖的子群，以及明确未覆盖的人群。",
    citations: [
      {
        source: "aapor",
        note: "Designing Your Sample：cover 与 sampling frame 的偏差、概率与非概率样本的差别；Fielding your Survey：多触达与无应答控制",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；渠道清单与各渠道回收量应在报告中保留，便于判断偏差方向。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "目标人群本身就是该社群成员且研究问题不涉及跨群比较时降 minor，但仍须声明渠道局限。",
    },
    errorExample: {
      description: "研究全体研究生，却只在研究生会核心群发放。",
      snippet: "问卷链接已发至研究生会工作群，请大家转发给同学填写。",
      why: "工作群成员更关注学生事务、更可能留校或活跃于组织；不活跃、校外实习与延期毕业者系统性缺席，工具使用与压力分布都会偏向某一侧。",
    },
    handling:
      "用多渠道组合（官方名单邮件、课程、社群、线下）并记录每份答卷的来源渠道；报告按渠道分层说明构成。不能概率抽样时明确声明便利样本，不写「代表全体」。",
  },
  {
    id: "sampling_recruitment.group_reach",
    dimension: "sampling_recruitment",
    title: "比较组触达与样本量未核对",
    claim:
      "群体比较须在设计阶段为每个比较组设定最低有效样本量，并核对渠道确实能触达该组。某组预计不足时应削减比较维度或改设计，不能等回收后再用小单元格解释差异。",
    citations: [
      {
        source: "aapor",
        note: "Designing Your Sample：样本设计须按子群规划可执行性与覆盖",
      },
      {
        source: "product",
        note: "research-data 的分组描述与交叉表按组计算样本与缺失，单元格过小则比例不稳（docs/product/research-data.md）",
      },
    ],
    appliesTo: {
      researchTypes: ["group_comparison"],
      notes:
        "适用于以组间差异为核心问题的群体比较；最低样本量按描述精度与单元格数估算，不按显著性检验的检验力估算（当前系统无推断检验）。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "某比较组预计无法触达或预计 n 为 0，且研究问题不可降级时升 blocker。",
    },
    errorExample: {
      description: "计划比较五个年级组，但招募只进入新生群。",
      snippet: "拟比较大一、大二、大三、大四与研究生在科研工具使用上的差异。",
      why: "后四组只能靠转发偶得，回收后多数交叉单元格 n 极小；比例随一两份答卷跳动，组间差异无法与噪声区分。",
    },
    handling:
      "为每组写出目标 n 与估算依据，按组配额招募并记录各组分母；触达不到的组在设计阶段合并或删除。分析时 n 低于阈值的单元格只报计数，不作解释。",
  },
  {
    id: "sampling_recruitment.convenience_disclosure",
    dimension: "sampling_recruitment",
    title: "便利样本未声明局限",
    claim:
      "通过转发、社群或众包招募的非概率样本，必须在研究说明与报告中声明「便利样本、不能推断总体」，并交代招募方式、收集时间窗、激励与可能的自选偏差。不得用「随机抽取」「有代表性」描述此类样本。",
    citations: [
      {
        source: "aapor",
        note: "Designing Your Sample：非概率样本需要透明声明与特殊处理，不能按概率样本解释",
      },
      {
        source: "product",
        note: "research-data 不做加权与总体推断，报告只能停留在样本描述（docs/product/research-data.md）",
      },
    ],
    appliesTo: {
      notes:
        "适用于非概率招募的一切研究类型；概率抽样且已掌握抽样框与应答率时可豁免本条的前半部分。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "样本仅用于内部改进、明确不外推且读者范围受限时降 minor。",
    },
    errorExample: {
      description: "把社群转发的答卷描述成随机样本与全国结论。",
      snippet: "本次调查随机抽取了 500 名研究生，结果可代表全国研究生情况。",
      why: "转发的样本没有抽样框与入样概率，无法计算抽样误差；「代表全国」会让读者把样本偏差当成总体事实。",
    },
    handling:
      "改为「通过<渠道>招募的便利样本（n=500，收集期…），结果仅描述样本」；标题与摘要不用「全国」「代表性」。确需加权时说明权重来源，并在系统外完成（当前产品不支持加权）。",
  },
  {
    id: "sampling_recruitment.consent_consistency",
    dimension: "sampling_recruitment",
    title: "知情同意与实际数据实践不一致",
    claim:
      "研究说明与同意文本必须与实际数据实践一致：承诺匿名却采集可识别信息、承诺可退出却没有退出路径、采集敏感数据却未写用途与保存期限，都使同意失效。consent 为空且问卷含身份或敏感题时直接阻断。",
    citations: [
      {
        source: "aapor",
        note: "Designing your questionnaire：protect respondents——保密承诺、敏感话题的退出与求助信息；知情同意须与实际做法一致",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；判定依据是 definition.consent 文本与题目、答案字段的实际采集行为，两者必须逐项对照。",
    },
    classification: "judgment",
    severity: {
      level: "blocker",
      conditions:
        "仅采集常规背景、consent 已写明用途与退出方式，只缺联系人或保存期限时降 minor。",
    },
    errorExample: {
      description: "问卷要求填写单位与职务，同意文本却承诺完全匿名。",
      snippet: "本问卷完全匿名，请填写你的单位、职务与联系方式。",
      why: "单位加职务加联系方式足以还原到个人，匿名承诺与采集行为矛盾；受访者基于错误承诺作出同意，伦理与合规都不成立。",
    },
    handling:
      "二选一：删除可识别字段（包括组合可识别），或把承诺改为「保密处理，仅研究团队可见，保存 X 个月后删除」。consent 必须写清用途、自愿、退出方式与联系人；敏感题另设非必答。",
  },
  {
    id: "sampling_recruitment.language_mismatch",
    dimension: "sampling_recruitment",
    title: "人群语言与问卷语言不匹配",
    claim:
      "问卷语言、术语与识字水平必须匹配目标人群；跨语言施测须做回译对照，并用目标人群做认知访谈确认语义等价。由研究者直译后直接上线，会把理解失败集中到某类人群，形成系统性缺失。",
    citations: [
      {
        source: "cosmin",
        note: "内容效度 comprehensibility 要素：目标人群须能理解题目与刻度（借自健康测量工具语境）",
      },
      {
        source: "cdc_cognitive",
        note: "作答复核模型的 comprehension 过程；目的抽样 20-50 人做认知访谈找理解问题，而非估计总体",
      },
    ],
    appliesTo: {
      notes:
        "适用于目标人群与研究者语言、术语体系不一致的问卷；同一语言内也存在识字与方言差异，按目标人群判断。",
    },
    classification: "human_data",
    severity: {
      level: "major",
      conditions:
        "问卷仅用目标人群日常语言、术语已在说明中定义且预测试无理解障碍时降 minor。",
    },
    errorExample: {
      description: "面向县域中学教师的问卷使用英文缩写与学术直译。",
      snippet: "请评价你的 research self-efficacy 与 academic workload 感知。",
      why: "未接触该术语的教师只能猜测，作答分布反映的是语言暴露而非构念水平；退出与缺失也集中在这部分人群，样本进一步偏斜。",
    },
    handling:
      "用目标人群样本（20-50 人，覆盖关键子群与低识字者）逐题做认知访谈；跨语言版本先回译再对照差异，记录每一处改动。理解存疑的题改写或删除，不能用加注脚代替重写。",
  },
  {
    id: "sampling_recruitment.vulnerable_groups",
    dimension: "sampling_recruitment",
    title: "弱势或权力不对等群体招募",
    claim:
      "涉及未成年人、患者、学生或下属等群体时，须确认同意主体、自愿性与最小风险措施，并由中立渠道招募。参与是否真的自愿不能由研究者判断，须在预测试中向同类人群核实其感受到的压力与退出体验。",
    citations: [
      {
        source: "aapor",
        note: "Designing your questionnaire：protect respondents——自愿参与、敏感话题的退出路径与资源信息",
      },
    ],
    appliesTo: {
      notes:
        "仅适用于涉及弱势群体或权力不对等人群的问卷；伦理审查要求高于本目录，本条只覆盖与问卷设计和招募直接相关的部分。",
    },
    classification: "human_data",
    severity: {
      level: "blocker",
      conditions:
        "匿名、无报酬、由中立第三方招募，且预测试确认无参与压力时降 major；未成年人缺监护人同意时不降级。",
    },
    errorExample: {
      description: "任课教师向自己班级发放问卷，并把填写计入课程参与。",
      snippet: "请同学们课后完成本问卷，作为课程参与的一部分。",
      why: "学生难以拒绝任课教师，「自愿」失效；拒绝者与顺从者在敏感题上的作答系统不同，缺勤者还整体缺席，样本与结论都被权力关系塑形。",
    },
    handling:
      "改由院系或第三方匿名渠道发放，明确与成绩、考核无关且可无理由退出；预测试中访谈几名学生是否感到压力。未成年人须监护人同意并走伦理审查，敏感题配求助资源。",
  },
];
