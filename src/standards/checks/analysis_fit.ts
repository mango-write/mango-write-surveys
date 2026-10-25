import type { StandardsCheck } from "../schema.js";

// 分析可行性维度：采集前确认每个研究问题都有可执行的变量与分析路径。
// research-data 当前只做描述、分组与交叉表，条目据此划清能做与不能做。
export const analysisFitChecks: StandardsCheck[] = [
  {
    id: "analysis_fit.variable_type_mismatch",
    dimension: "analysis_fit",
    title: "变量类型与拟用分析不匹配",
    claim:
      "每道题须标注产出的变量类型（categorical、multiple、ordinal、number、text、date），拟用分析只能作用在匹配类型上：文本不能当分类变量交叉，日期不进均值，多选题不能按单选比例解读。分析计划与变量类型错位，采集后无法补救。",
    citations: [
      {
        source: "product",
        note: "research-data 的变量类型清单与逐类分析方法：频数/比例、有效数/缺失、均值/中位数、分组描述、交叉计数（docs/product/research-data.md）",
      },
      {
        source: "aapor",
        note: "Analyzing and reporting your survey：分析口径须与题目形式及测量水平一致",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；判定依据是每题的题型与选项结构，以及分析计划中对该题的使用方式。",
    },
    classification: "judgment",
    severity: {
      level: "blocker",
      conditions:
        "仅个别非核心题错配、且不进入主结论时降 major。",
    },
    errorExample: {
      description: "把开放式文本当作分组变量做交叉，或对日期求均值。",
      snippet: "分析计划：按「你常用的工具」文本回答分组，比较各组满意度均值；并计算平均入校日期。",
      why: "文本需先编码成有限类别，编码方案未定义则分组不可重复；日期是时间点，求均值没有解释意义，还会掩盖分布形状。",
    },
    handling:
      "建「题目→变量类型→分析方法」映射，逐题核对；文本题若必须量化，先定编码手册并由人工编码（系统不自动编码）；日期只做频数与时间分布；多选题按有效答卷分母单独处理。",
  },
  {
    id: "analysis_fit.matrix_as_category",
    dimension: "analysis_fit",
    title: "矩阵题整体当分类变量",
    claim:
      "矩阵题按行展开为多个有序或分类变量，不能把整组矩阵当作一个分类变量与另一变量交叉。一次分析只能使用单行，或其事后合成的总分；合成须在系统外按预注册规则完成。",
    citations: [
      {
        source: "product",
        note: "research-data 将矩阵、排序与多项填空按行或项展开成多变量；维度合成与反向题反转不在系统内自动完成（docs/product/research-data.md）",
      },
    ],
    appliesTo: {
      questionTypes: ["matrix_single", "matrix_multiple", "matrix_text"],
      notes:
        "适用于任何以矩阵承载多行测量的题目；行为事实型矩阵（如各场所使用频率）同样按行处理，不能整体交叉。",
    },
    classification: "rule",
    severity: {
      level: "major",
      conditions:
        "矩阵行数 ≤2 且分析计划明确逐行处理时不算违反；把首行当作整体代表时升 blocker。",
    },
    errorExample: {
      description: "分析计划把 10 行李克特矩阵作为一个变量与年级交叉。",
      snippet: "分析计划：将「工作感受矩阵」整体与年级做交叉表。",
      why: "矩阵不是单一分类变量，整体交叉在工具里没有定义；人工合并会掩盖行间差异，也无法说明用的是哪一行或什么权重。",
    },
    handling:
      "逐行分析并在图表中标明行标签；需要总分时在导出后按预注册规则合成，写明反向题处理与缺失规则，并在报告中给出计算过程；不要用首行代替整体。",
  },
  {
    id: "analysis_fit.group_sample_feasibility",
    dimension: "analysis_fit",
    title: "分组交叉的单元格样本不可行",
    claim:
      "群体比较的分析计划须给出每组预期有效 n 与交叉单元格最小 n。当前系统只做描述与交叉计数，单元格过小时比例不稳定；分析计划必须预先规定小单元格只报计数、不解释，不能事后合并组来制造差异。",
    citations: [
      {
        source: "product",
        note: "分组描述、交叉计数与行比例按单元格计算，无显著性检验与效应量可辅助判断差异是否超出噪声（docs/product/research-data.md）",
      },
      {
        source: "aapor",
        note: "Analyzing and reporting your survey：子群样本不足时须说明局限，不能过度解读",
      },
    ],
    appliesTo: {
      researchTypes: ["group_comparison"],
      notes:
        "适用于计划做分组交叉的群体比较；阈值按单元格数与分析粒度设定，不套用检验力的样本量公式。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "比较指标很少、每组预计 n 充足且已声明小单元格规则时降 minor；单元格普遍个位数仍作组间结论时升 blocker。",
    },
    errorExample: {
      description: "交叉分类后出现极小分母，却据此作稳定组间结论。",
      snippet: "某年级实际收到 20 份答卷，其中某工具用户仅 2 人；计划据这 2 人的使用比例评价该年级全部学生。",
      why: "每人可回答多个指标，不能把 20 人机械分摊到指标；真正限制来自交叉类别的实际人数与缺失，2 人不足以支持所述稳定总体结论。",
    },
    handling:
      "设计阶段估算每组最小 n 与单元格数，必要时减少分组或指标；分析计划写明低于阈值只报计数、不作解释，并在固定运行中保留各单元格分母与缺失数。",
  },
  {
    id: "analysis_fit.scale_without_plan",
    dimension: "analysis_fit",
    title: "量表无合成与信度计划",
    claim:
      "使用多题量表时，分析计划须写明维度合成规则、反向题处理、缺失处理与信度评估方式。系统不自动计算 α、合成分数或反转反向题；未写计划就宣称「量表可信」「维度得分高」，属于没有计算来源的结论。",
    citations: [
      {
        source: "product",
        note: "research-data 不支持信度分析、合成分数自动计算与反向题自动反转；量表题只逐题输出分布与统计量（docs/product/research-data.md）",
      },
      {
        source: "cosmin",
        note: "内容效度不替代信度：题目覆盖构念成立后仍须另行评估一致性（借自健康测量工具语境）",
      },
    ],
    appliesTo: {
      researchTypes: ["attitude_scale"],
      notes:
        "适用于计划报告维度得分、量表总分或信度系数的多题测量；只逐题描述、不做任何合成的量表不受本条的前半部分约束。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "量表结论仅作探索、报告明确标注未经信度检验时降 minor；以「已验证量表」名义用于对外结论时升 blocker。",
    },
    errorExample: {
      description: "报告直接给出信度系数与维度得分，但从未在系统内外计算。",
      snippet: "本量表 Cronbach α=0.89，信度良好；工作投入维度得分 4.2。",
      why: "系统不产出这些数字，报告也没有计算过程与样本说明；读者无法复核，反向题若未反转，维度得分方向甚至可能是错的。",
    },
    handling:
      "分析计划写清合成规则、反向题清单、缺失处理与信度计算工具和版本；这些步骤在系统外完成并在报告中给出过程。系统内只报逐题分布，不生成「信度良好」结论。",
  },
  {
    id: "analysis_fit.multiselect_denominator",
    dimension: "analysis_fit",
    title: "多选题分母未声明",
    claim:
      "多选题的分母是有效答卷数而不是选项被选次数。报告选择率、交叉表或图表时必须声明口径（占有效答卷的百分比，或选择次数占比），否则比例不可解释，且各选项比例之和超过 100% 会被误读。",
    citations: [
      {
        source: "product",
        note: "多选题分母为有效答卷；各选项按选择率呈现（docs/product/research-data.md）",
      },
    ],
    appliesTo: {
      questionTypes: ["multiple", "image_multiple"],
      notes:
        "适用于所有多选型题目；带 minChoices/maxChoices 的题目仍以有效答卷为分母，另需报告选择数量分布。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "图表脚注已写明分母、且正文未作跨口径比较时降 minor。",
    },
    errorExample: {
      description: "把选项被选次数占总选择次数的比例当作人群比例。",
      snippet: "报告：60% 的受访者选择「文献管理」。（实为 60/100 个选择次数）",
      why: "同一人多选会让分母膨胀，60% 既不等于人群占比，也无法与单选比例比较；读者会把多选分布误当成人群构成。",
    },
    handling:
      "在分析计划与图表脚注写明分母为有效答卷 n；正文统一按答卷口径报比例，选择次数另列一栏；全不选、缺失与跳题样本单独报告。",
  },
  {
    id: "analysis_fit.required_missing_design",
    dimension: "analysis_fit",
    title: "必答与非必答的缺失设计缺失",
    claim:
      "每道题须在设计阶段决定必答或非必答，并说明缺失机制。关键描述变量与分组变量宜必答；敏感、隐私或需要回忆的题应允许跳过或加「不愿回答」，并预先规定缺失报告方式。不能把「全部必答」当默认。",
    citations: [
      {
        source: "aapor",
        note: "Fielding your Survey：item nonresponse 与 breakoff 须在设计阶段控制并在报告中交代",
      },
      {
        source: "product",
        note: "research-data 逐变量报告有效数与缺失数，固定运行保留缺失口径（docs/product/research-data.md）",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；必答设置影响拒答率与数据真实性，不能只看回收完整率。",
    },
    classification: "judgment",
    severity: {
      level: "major",
      conditions:
        "仅背景题设为非必答且缺失率可忽略时降 minor；敏感题全设必答时升 blocker。",
    },
    errorExample: {
      description: "含收入与心理状态的问卷全卷强制必答。",
      snippet: "本问卷所有题目均为必答。第 18 题：你的年收入区间是？第 22 题：过去两周你是否持续情绪低落？",
      why: "强制作答把「不愿答」变成随手编一个，缺失率下降但数据质量更差；敏感题还会推高中途退出，且退出者与完成者在这些题上系统不同。",
    },
    handling:
      "核心变量与分组变量必答，敏感/隐私/高回忆负担题设为非必答或提供「不愿回答」；分析计划按变量写明缺失处理与报告口径，缺失率超阈值时在结果中说明。",
  },
  {
    id: "analysis_fit.cross_time_wording_change",
    dimension: "analysis_fit",
    title: "跨时间比较改动题目措辞",
    claim:
      "跨时间或跨版本比较的题目须保持题干、选项、刻度与顺序完全一致。任何措辞或选项变更都会移动作答门槛，构成新的测量；必须改时须做桥接或明确标注断点，不能直接比较前后比例。",
    citations: [
      {
        source: "pew",
        note: "Measuring change over time：跨时间比较不能改题目措辞与作答选项，否则变化无法与测量变化区分",
      },
    ],
    appliesTo: {
      notes:
        "适用于与既往调查或上一轮问卷做趋势比较的题目；单次横断面研究不涉及本条。",
    },
    classification: "judgment",
    severity: {
      level: "blocker",
      conditions:
        "改动仅涉及错别字且不改变语义时可豁免；新增题目与旧题并行施测并做桥接时降 minor。",
    },
    errorExample: {
      description: "为追赶热词改写题干后直接比较两年使用率。",
      snippet: "2024：你使用 AI 工具的频率？／2025：你使用生成式 AI 的频率？",
      why: "「AI 工具」与「生成式 AI」的外延不同，作答门槛随定义变化；观察到的上升可能来自词义收窄或曝光增加，而不是使用行为变化。",
    },
    handling:
      "冻结比较题的原文与选项，新增维度另设新题；必须修改时同卷并行旧题做桥接，或在报告中明确标出断点并停止趋势解释。版本变更记录写进固定运行说明。",
  },
  {
    id: "analysis_fit.analysis_plan_mapping",
    dimension: "analysis_fit",
    title: "分析计划未映射到变量",
    claim:
      "发布采集前须有「研究问题→变量→题型→分析输出→结论句式」的映射，且每个分析输出都能由当前系统生成。映射缺失时，不可回答的问题与缺失变量只能等到采集后才发现，届时无法补采。",
    citations: [
      {
        source: "product",
        note: "research-data 的固定运行、变量字典与 CSV 导出是分析输出的边界；不支持的输出须在计划中另行安排（docs/product/research-data.md）",
      },
      {
        source: "aapor",
        note: "Planning Your Survey：研究问题、样本与分析计划须在采集前确定，不能事后补设计",
      },
    ],
    appliesTo: {
      notes:
        "适用于一切研究类型；映射表可与问卷定义一同归档，固定运行时与变量字典配套保留。",
    },
    classification: "judgment",
    severity: {
      level: "blocker",
      conditions:
        "探索性研究且明确只做逐题描述、结论限于样本时降 major；对外结论仍须完整映射。",
    },
    errorExample: {
      description: "发布后才发现比较所需的分组变量未采集，且计划的分析系统不支持。",
      snippet: "分析计划（采集后补写）：比较不同培养方式学生的能力差异，并做回归控制年级。",
      why: "培养方式没有对应题目，回归也不在当前能力内；数据采集完才暴露缺口，只能丢弃研究问题或另做一轮调查。",
    },
    handling:
      "设计阶段产出映射表，逐行核对变量是否存在、题型是否产出该类型、分析是否在支持清单内；不支持的分析改为人工处理或删除该目标。固定运行时把映射、变量字典与运行版本一起归档。",
  },
];
