import type { StandardsCheck } from "../schema.js";

// 流程维度：题序、分页与跳转是否让受访者在未被污染的框架下作答。
// 以 judgment 为主：顺序效应与链条断裂靠 AI 审查定位，污染的实际程度只有预测试能给出。
export const flowChecks: StandardsCheck[] = [
  {
    id: "flow.context_contamination",
    dimension: "flow",
    title: "顺序效应污染",
    claim:
      "题序不得让前序题目改变后序题目的作答框架：先问具体维度评价再问总体满意度（或先问价格再问性价比）会产生对比/同化效应，后序题测到的是「相对于前题」而非真实态度。",
    citations: [
      {
        source: "pew",
        note: "Question order 节：顺序效应——contrast effects 与 assimilation effects，前序题改变后序题参照系",
      },
      {
        source: "cdc_cognitive",
        note: "judgment 过程：受访者拿前序题目作参照完成后续判断，无法回到无上下文状态",
      },
    ],
    appliesTo: {
      notes: "适用于含评价/满意度/重要性序列的问卷；仅当前后题测量同一构念的不同层级时命中。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "前后题测完全独立构念且题干自带绝对参照时不命中；被污染的是分组比较或量表核心指标（数据无法事后拆分）时升 blocker。",
    },
    errorExample: {
      description: "先逐项吐槽服务细节，再问总体满意度。",
      snippet: "（第5题）你对客服响应速度满意吗？…（第9题）总体而言你对本服务满意吗？",
      why: "具体不满被带到第 9 题当参照，总体满意度里混入对比效应；想测的「无提示总体态度」已不可恢复。",
    },
    handling:
      "总体题前置或与具体题分页分隔，并在总体题题干重申绝对参照；核心指标的顺序污染只能靠分卷实验确认后定稿（见 flow.order_effects_pretest）。",
  },
  {
    id: "flow.general_before_specific",
    dimension: "flow",
    title: "先具体后一般",
    claim:
      "同一主题的一般题必须先于具体题：先暴露具体信息会收窄受访者对一般题的理解范围，一般题的分布只代表被提示后的口径，与未提示的常态不可比。",
    citations: [
      {
        source: "pew",
        note: "Question order 节：先一般后具体——先问具体会收窄一般题的作答框架",
      },
    ],
    appliesTo: {
      notes: "适用于含层级关系的题组（总体满意度+分项评价、总体使用情况+分场景频率）；单层题序不适用。",
    },
    classification: "judgment",
    severity: {
      level: "minor",
      conditions: "具体题与一般题测量不同对象（不构成层级）时不命中；两题构成筛查-追问链时按 flow.screening_chain 处理，不算违反。",
    },
    errorExample: {
      description: "先问通勤场景细节，再问总体数字化生活。",
      snippet: "（先）你每周在通勤路上使用 App 吗？（后）总体而言你的数字化生活程度如何？",
      why: "问完通勤场景，「数字化生活」在受访者脑中已缩窄为 App 使用，一般题的分布带上了提示口径。",
    },
    handling:
      "对调顺序使一般题先答；无法对调时在一般题题干完整列出范围提示（「含工作、学习、娱乐各类场景」）。",
  },
  {
    id: "flow.sensitive_late",
    dimension: "flow",
    title: "敏感题前置",
    claim:
      "敏感题（违规行为、收入、心理健康、倾向类）必须安排在信任建立之后的中后段：卷首直陈敏感题把退出率堆在最前，幸存样本带自选择偏差，后续所有分布都不可信。",
    citations: [
      {
        source: "pew",
        note: "Question order 节：敏感题放后段——受访者先建立信任再面对敏感提问",
      },
      {
        source: "aapor",
        note: "Designing your questionnaire：protect respondents——敏感题的呈现位置与拒答路径要保护受访者",
      },
    ],
    appliesTo: {
      notes: "敏感度由话题性质与目标人群共同决定；同一问题对不同人群敏感度不同，判定按目标人群口径。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "全卷非自证口径且匿名承诺充分时降 minor；敏感题是研究核心测量无法回避时保持 major，且必须配拒答出口。",
    },
    errorExample: {
      description: "卷首必答学术不端行为。",
      snippet: "（第1题）你过去一年有过学术不端行为吗？〔是/否〕（必答）",
      why: "卷首必答敏感题把守规矩的受访者直接劝退，留下高耐受样本，后续所有题目的分布都带自选择偏差。",
    },
    handling:
      "移入中后段并允许拒答（非必答或「不愿回答」选项）；卷首放易题与信任建立内容，匿名与数据用途在研究说明声明。",
  },
  {
    id: "flow.demographics_position",
    dimension: "flow",
    title: "人口学题前置",
    claim:
      "人口学题（年龄、性别、收入、学历）应置于卷末：放卷首抬高首屏退出率，且身份自我分类抢先成为后续题目的参照框架，污染作答口径。",
    citations: [
      {
        source: "pew",
        note: "Question order 节：人口学题放卷末——前置推高早期退出并框定后续作答",
      },
      {
        source: "aapor",
        note: "Fielding your Survey：题目放置位置影响完成率与无应答偏差",
      },
    ],
    appliesTo: {
      notes: "分组比较研究需在卷首筛分（如先确认年级再走 showIf）时，前置的只保留驱动跳页的最小集合，其余描述性人口学题仍放卷末。",
    },
    classification: "judgment",
    severity: {
      level: "minor",
      conditions: "分组变量必须前置驱动跳页时不算违反（此时它是筛选题不是描述题）；匿名卷且人口学题不影响作答框架时降 minor 保留。",
    },
    errorExample: {
      description: "两道人口学题放在全卷最前。",
      snippet: "（第1题）您的年龄段是？（第2题）您的税后年收入是？",
      why: "最敏感的身份信息放在退出率最高的位置；未答样本与答题样本的年龄、收入分布不可比，人口学题还先给了后续题一个身份参照。",
    },
    handling:
      "移到卷末；确需前置的分组题只保留驱动跳页的最小集合并在研究说明写清前置理由。",
  },
  {
    id: "flow.screening_chain",
    dimension: "flow",
    title: "筛选追问链断裂",
    claim:
      "任何预设受访经历或身份的追问必须由可达的筛选题保证：筛选题要含「无此经历」出口，showIf 条件引用的选项必须真实存在；链条断裂时，不满足前提的受访者被迫编造或整卷作废。",
    citations: [
      {
        source: "aapor",
        note: "Designing your questionnaire：题序逻辑与跳转——追问只向符合条件的受访者呈现",
      },
      {
        source: "cdc_cognitive",
        note: "response 过程：前提不成立时受访者选最近似选项而非指出问题，假数据静默进入",
      },
    ],
    appliesTo: {
      notes: "适用于一切带 showIf 的题目与页级 jump；与 wording.presumptive 互补——那条管题干措辞，本条管流程可达性。",
    },
    classification: "judgment",
    severity: {
      level: "blocker",
      conditions: "追问的是可选经历补充、不影响核心数据时降 major；被断分支永不可达（条件恒假）时按死分支清理，降 minor。",
    },
    errorExample: {
      description: "筛选项无出口且追问条件引用不存在的选项。",
      snippet:
        "（Q1）你是否使用过 Zotero？〔是/否〕 →（Q2, showIf: Q1=用过）你每周用 Zotero 管理多少篇文献？",
      why: "筛选项「否」没有去路，Q2 条件引用了不存在的选项 id；没用过的受访者被留在 Q2 前编造一个数字，追问数据大面积失真。",
    },
    handling:
      "补筛选题「无此经历」出口并用 showIf 只向符合者呈现；条件引用与筛选题选项对齐，规则引擎静态校验链可达性，生成器产出追问链时自动配筛选与跳过路径。",
  },
  {
    id: "flow.jump_logic",
    dimension: "flow",
    title: "跳页逻辑不闭环",
    claim:
      "页级 jump 与题目级 showIf 必须形成闭环：每个 jump 目标页存在，被跳过的页不漏收路径上的必答题，跳转不把受访者困在无法到达提交页的分支；分页还须保证同一分支内的题在进度上连续。",
    citations: [
      {
        source: "product",
        note: "系统能力：页 jump 由 when/targetPageId 定义，服务端按绑定版本重算路径并校验；结构合法性归 core/validate-definition",
      },
      {
        source: "aapor",
        note: "Designing your questionnaire：题序逻辑自洽，受访者不遇到与己无关的题、不遗漏与己相关的题",
      },
    ],
    appliesTo: {
      notes: "适用于多页问卷与带 showIf 的题；单页问卷不适用。分页结构的存在性由结构校验负责，本条管测量意义上的跳页正确性。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "跳页错误发生在纯说明页或可选分支上降 minor；导致必答题整页不可达或提交路径断裂时升 blocker。",
    },
    errorExample: {
      description: "分支跳页漏收必答题。",
      snippet: "P1 选「否」→ jump 到 P3，但 P2 含全卷必答题 Q5",
      why: "走该分支的受访者永远看不到 Q5，要么被进度卡住要么 Q5 全缺失；缺失与分支选择相关（非随机缺失），分析时无法补救。",
    },
    handling:
      "跳页后核对每条路径的必答题覆盖（路径×必答矩阵）；把分支专属题收进分支页内或改为非必答；发布前按服务端重算路径跑一遍全路径检查。",
  },
  {
    id: "flow.topic_grouping",
    dimension: "flow",
    title: "主题分组混杂",
    claim:
      "题目应按主题连续分组，同组题不被他组题打断：跨主题穿插迫使受访者反复切换语境，加重理解负担并放大顺序效应。",
    citations: [
      {
        source: "pew",
        note: "Question order 节：按主题分组，相关题目连续排列",
      },
    ],
    appliesTo: {
      notes: "适用于多主题问卷；单主题短卷（10 题以内）不适用。",
    },
    classification: "judgment",
    severity: {
      level: "minor",
      conditions: "分组被打断是为抵消已知顺序效应（插入缓冲题）时不算违反，但须在研究说明记录插入理由。",
    },
    errorExample: {
      description: "使用行为、满意度、人口学三类题交替出现。",
      snippet: "使用频率 → 满意度 → 年龄 → 使用场景 → 收入",
      why: "每两题切换一次语境；「年龄」横在使用行为中间，还抢先给后面的满意度题提供了身份参照。",
    },
    handling:
      "重排为「使用行为 → 满意度 → 人口学」三段；用缓冲题抵消顺序效应时明确记录并保持组内连续。",
  },
  {
    id: "flow.order_effects_pretest",
    dimension: "flow",
    title: "顺序效应未实测",
    claim:
      "顺序效应的存在与大小无法从静态问卷定义判定：哪些题序组合会污染、污染多深，只能靠分卷实验（split-ballot）或认知访谈实测发现；静态检查只能给出可疑位置提示，不能替代实测。",
    citations: [
      {
        source: "cdc_cognitive",
        note: "认知访谈以目的抽样 20-50 人找问题而非估计——题序影响在访谈中方可直接观察",
      },
      {
        source: "aapor",
        note: "Fielding your Survey：认知访谈与 pretest/pilot 是上线前发现题序与理解问题的规定动作",
      },
    ],
    appliesTo: {
      notes: "适用于一切含评价序列的问卷；无预测试预算时至少对核心指标题做小样本认知访谈。",
    },
    classification: "human_data",
    severity: {
      level: "major",
      conditions: "纯描述性现状调查且无评价序列时降 minor；核心指标未经任何实测即上线、且怀疑存在顺序污染时升 blocker（发布前必须补实测）。",
    },
    errorExample: {
      description: "团队凭静态评审认定题序无问题直接发布。",
      snippet: "（评审记录）题序已人工检查，无顺序效应问题。",
      why: "静态评审看到的只是题面，受访者实际带着第 3 题的参照答第 7 题；未实测的顺序污染在数据里不可见，发布后不可补救。",
    },
    handling:
      "发布前对可疑题序对做 split-ballot 小样本实测或认知访谈，结论记入研究说明；无实测条件时在报告限制中写明「题序效应未评估」。",
  },
];
