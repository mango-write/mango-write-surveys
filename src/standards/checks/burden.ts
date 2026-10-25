import type { StandardsCheck } from "../schema.js";

// 负担维度：题量、必答、矩阵与开放题的设计是否把完成成本控制在受访者愿意诚实作答的范围内。
// 计数类条目（题量、必答比、矩阵行数、开放题数）可程序判定；时长与重复度依赖实测与语义判断。
export const burdenChecks: StandardsCheck[] = [
  {
    id: "burden.total_questions",
    dimension: "burden",
    title: "总题量超载",
    claim:
      "全卷题量应按预估完成时长收敛：科研问卷的建议口径是 30 题以内、10-15 分钟可答完；系统承载上限 50 题是容量边界不是质量标准——贴着上限设计的问卷完成率会系统性坍塌，且后段题目只收到高耐受幸存者样本。",
    citations: [
      {
        source: "product",
        note: "系统硬上限：题数 ≤50、页 ≤20——承载能力边界，不构成设计建议（硬上限不等于好标准）",
      },
      {
        source: "aapor",
        note: "问卷长度主题：长问卷推高无应答与中途退出，长度能短则短",
      },
    ],
    appliesTo: {
      notes: "一切问卷；attitude_scale 的题数按「维度×每题数」估算，矩阵行不计题数但计入负担（见 burden.matrix_rows）。",
    },
    classification: "rule",
    severity: {
      level: "major",
      conditions: "有激励或强归属感的专业样本可放宽至 40 题；超过 30 题须在研究说明写明理由、时长预估与完成率保护措施。",
    },
    errorExample: {
      description: "贴着系统上限堆题。",
      snippet: "全卷 50 题、20 页，卷首声明「预计 5 分钟」",
      why: "实测要 20 分钟以上的匿名链接问卷完成率通常不足两成；后 1/3 的题只收到高耐受样本，分布自选择且与题序污染叠加。",
    },
    handling:
      "压到 30 题内：删非核心题、合并近重复题、把同刻度题组矩阵化；超 30 题必须给出时长预估与保护措施（分次发放、进度提示），规则引擎按题数阈值直接报数。",
  },
  {
    id: "burden.required_ratio",
    dimension: "burden",
    title: "必答比例过高",
    claim:
      "必答题必须收敛到核心测量题：必答比例过高（尤其敏感题与边缘信息题也必答）会把「不适用/不愿答」的受访者推向乱选或退出；程序可按 required 标志统计必答占比，标准要求非核心题不得必答。",
    citations: [
      {
        source: "aapor",
        note: "Designing your questionnaire：保护受访者——提供拒答与跳过路径，不强迫作答",
      },
      {
        source: "product",
        note: "系统能力：每题 required 标志驱动服务端校验，必答缺口阻断提交——逼出的可能是假数据",
      },
    ],
    appliesTo: {
      notes: "统计口径为 required 题数/总题数；text/multi_text 开放题与敏感话题题默认不应必答。",
    },
    classification: "rule",
    severity: {
      level: "major",
      conditions: "核心分组变量与量表题项保持必答；必答占比 ≤50% 且敏感题全部非必答时不算违反。",
    },
    errorExample: {
      description: "收入与家庭情况都设为必答。",
      snippet: "（Q12）你过去的收入是多少？（必答）（Q13）请描述你的家庭支持情况（必答，开放题）",
      why: "不适用的受访者只能填 0 或乱写，敏感必答还直接推高退出率；服务端校验反而替研究者「逼出」了假数据。",
    },
    handling:
      "把非核心题改非必答；确需强应答的题给出「不适用/不愿回答」显式选项而非依赖必答逼迫；规则引擎输出必答占比与必答题清单供人工裁量。",
  },
  {
    id: "burden.matrix_rows",
    dimension: "burden",
    title: "矩阵行数超载",
    claim:
      "矩阵题行数应按单次判断的认知负担收敛：每行是一次独立判断，建议不超过 10 行；系统上限 20 行是承载边界不是质量标准——贴上限的矩阵在自填场景下后段行的直线作答与随机勾选比例显著上升。",
    citations: [
      {
        source: "product",
        note: "系统硬上限：矩阵行 ≤20、列 ≤10——承载能力边界，不构成设计建议（硬上限不等于好标准）",
      },
      {
        source: "cdc_cognitive",
        note: "judgment 过程：连续同类判断的疲劳使后段行作答质量下降，受访者用最少策略收尾",
      },
    ],
    appliesTo: {
      questionTypes: ["matrix_single", "matrix_multiple", "matrix_text"],
      notes: "列数过多同样加重负担（列 ≤10 的系统上限同理由）；matrix_text 每行还要额外书写，负担权重更高。",
    },
    classification: "rule",
    severity: {
      level: "major",
      conditions: "行是同一简短判断（五级同意度短句）时可放宽至 15 行；超过 10 行须在研究说明记录理由并预期待后段行质量下降。",
    },
    errorExample: {
      description: "单矩阵 20 行逐项评分。",
      snippet: "请对以下 20 个校园服务逐项评分（1-5）",
      why: "第 15 行之后大量受访为求快速结束连续勾同一列，后 1/3 行的数据噪声淹没真实差异，均值得分不可信。",
    },
    handling:
      "拆成两个矩阵或删低优先级行；保留大矩阵时把核心行前置并在页说明告知工作量；直线作答比例留待分析期核查。",
  },
  {
    id: "burden.open_text_count",
    dimension: "burden",
    title: "开放题数量过多",
    claim:
      "全卷开放作答（text/multi_text）题应控制在 3 题以内：每题开放作答的成本是选择题的数倍，开放题过多把完成时长与弃答率一起推高，且文本数据的分析出口当前只有人工阅读。",
    citations: [
      {
        source: "product",
        note: "系统硬上限：单题文本 ≤2000 字——承载能力边界；research-data 当前无文本分析出口",
      },
      {
        source: "aapor",
        note: "问卷长度主题：开放作答成本远高于封闭选项，数量须克制",
      },
    ],
    appliesTo: {
      questionTypes: ["text", "multi_text"],
      notes: "multi_text 按项数折算负担；「其他（请注明）」类短开放不计入。",
    },
    classification: "rule",
    severity: {
      level: "minor",
      conditions: "研究问题本身是质性导向时可放宽，但须在研究说明写明文本处理计划；短注明型开放（预期 ≤20 字）不计数。",
    },
    errorExample: {
      description: "全卷 5 道必答长文本开放题。",
      snippet: "请详细描述……（2000 字上限）×5（均必答）",
      why: "5 道必答长文本把预估时长拉到 20 分钟以上，移动端受访者大面积弃答；收回的文本长短悬殊，相互不可比。",
    },
    handling:
      "压到 3 题内并只保留核心开放题；长文本改非必答；可枚举的信息改为封闭选项加「其他」短注明。",
  },
  {
    id: "burden.duplicate_questions",
    dimension: "burden",
    title: "近重复题目",
    claim:
      "全卷不得出现语义近重复的题目：重复题不增加信息只增加负担，还制造同一受访两次作答不一致的内部矛盾，污染数据质量印象。",
    citations: [
      {
        source: "aapor",
        note: "Designing your questionnaire：避免冗余提问——每一题都要有存在的理由",
      },
      {
        source: "cdc_cognitive",
        note: "recall 过程：同卷重复询问迫使受访者二次回忆，后一次作答受前一次锚定",
      },
    ],
    appliesTo: {
      notes: "含量表反向题在内的近重复；反向计分题是有效设计不算重复，但同一构念的正反陈述不超过必要对数。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions: "重复是为信度检验故意设置的平行题时不算违反，但须限定数量并记录用途；措辞差异大但测同一窄构念时仍算重复。",
    },
    errorExample: {
      description: "同一构念间隔八题再问一遍。",
      snippet: "（Q7）你对导师指导频率满意吗？（Q15）导师给你的指导够不够频繁？",
      why: "受访者第二次受第一次锚定，两题轻微不一致时无法判断哪个是真实态度，还白付一次判断负担。",
    },
    handling:
      "合并为一道；确需信度平行题时精选并记录用途；规则引擎做题干相似度预筛，AI 审查确认后合并。",
  },
  {
    id: "burden.minmax_choices",
    dimension: "burden",
    title: "多选数量约束失当",
    claim:
      "多选题的 minChoices/maxChoices 必须与选项集结构和研究口径匹配：minChoices 过高会逼「只符合一项」的受访者虚报，maxChoices 与选项总数倒挂（如 30 选 29）使约束失去意义。",
    citations: [
      {
        source: "product",
        note: "系统能力：multiple/image_multiple 的 minChoices/maxChoices 字段由服务端校验",
      },
      {
        source: "pew",
        note: "Open- and closed-ended questions：select-all 与 forced-choice 的选择须服务研究口径",
      },
    ],
    appliesTo: {
      questionTypes: ["multiple", "image_multiple"],
      notes: "minChoices=0 或 1 时不构成负担问题；maxChoices≥选项数-1 时约束近乎失效。",
    },
    classification: "judgment",
    severity: {
      level: "minor",
      conditions: "minChoices=1 等价必答单选，不构成强迫多选；maxChoices 略小于选项数且口径是「最多 N 项主要因素」时不算违反。",
    },
    errorExample: {
      description: "共 4 个选项却要求至少选 3 项。",
      snippet: "你最看重的择业因素有哪些？（至少选 3 项，共 4 项）〔…〕",
      why: "只有两项符合条件的受访者被迫再虚报一项，「最看重」的信号被数量下限污染。",
    },
    handling:
      "minChoices 降到 1 或 0；maxChoices 与选项数保持有意义的差距或直接去掉约束；口径判断联动 options.forced_choice。",
  },
  {
    id: "burden.long_stems",
    dimension: "burden",
    title: "长题干嵌套",
    claim:
      "题干长度与从句嵌套深度须受控：单题题干超过两行或含三重以上从句时，自填场景（尤其移动端）理解成本陡增；长题干应拆为「说明加短题干」结构，主句只留一个问题核心。",
    citations: [
      {
        source: "cdc_cognitive",
        note: "comprehension 过程：长嵌套句超出工作记忆负荷，自填场景无访员可追问",
      },
      {
        source: "aapor",
        note: "Designing your questionnaire：问题要短、一次一个概念",
      },
    ],
    appliesTo: {
      notes: "适用于题干与页说明；矩阵行陈述同样适用（行本身应是短句）。与 wording 维度互补——那条管问了几件事，本条管句子多长多绕。",
    },
    classification: "judgment",
    severity: {
      level: "minor",
      conditions: "长题干是为敏感题提供语境与匿名保证（必要的长说明）时不算违反；超长且含三重以上嵌套从句时升 major。",
    },
    errorExample: {
      description: "四重限定套在一个问句里。",
      snippet:
        "结合你在过去一学期中修读的、由本院系开设的、且采用了过程性考核的专业选修课程，你对这类课程线上学习资源的及时更新情况是否满意？",
      why: "受访者先得解析句子再回忆事实，移动端一屏放不下；理解成本全变成作答噪声，还诱发直线跳过。",
    },
    handling:
      "限定条件移入页说明或题干前缀短提示，主句压到一行；必要语境放说明块，题干只留一个问题核心。",
  },
  {
    id: "burden.completion_time_estimate",
    dimension: "burden",
    title: "时长预估未实测",
    claim:
      "「预计 X 分钟」不能由题数拍脑袋外推：实际完成时长受题型结构、设备与人群熟悉度影响，只能靠试点实测中位时长获得；未实测的时长预估要么劝退受访者（高估），要么让中途退出远超预期（低估）。",
    citations: [
      {
        source: "aapor",
        note: "Fielding your Survey：pretest/pilot 实测完成时间与卡点，是发放前规定动作",
      },
      {
        source: "cdc_cognitive",
        note: "认知访谈可直接观察各题耗时分布，20-50 人样本即可暴露超时题",
      },
    ],
    appliesTo: {
      notes: "一切对外发放的问卷；内部小范围测试可放宽但须记录实际耗时。",
    },
    classification: "human_data",
    severity: {
      level: "major",
      conditions: "10 题以内单页问卷可按经验值声明；超 20 题未实测即高精度声明时长时升 blocker（发布前必须实测）。",
    },
    errorExample: {
      description: "40 题问卷声明 5 分钟。",
      snippet: "本问卷约 40 题，预计 5 分钟完成。",
      why: "实测中位 18 分钟；声明偏差让大量受访者在第 10 题附近退出，且退出集中在低耐受人群，完成样本自选择。",
    },
    handling:
      "发布前跑 5-10 人试点取中位时长，按实测值声明并留 20% 余量；卷首与发放页用同一实测口径；试点记录各题耗时，超时题回负担维度处理。",
  },
];
