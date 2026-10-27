// Agent 审查是内部代理证据；真实人群理解与测量表现须另行验证（#224）。
import type { CheckSeverity } from "./schema.js";

export const REVIEW_PROTOCOL_STATUS = "draft-agent-review" as const;

export interface SeverityLevel {
  id: CheckSeverity;
  name: string;
  definition: string;
  repairExpectation: string;
}

export const SEVERITY_LEVELS: SeverityLevel[] = [
  {
    id: "blocker",
    name: "阻断",
    definition:
      "缺陷使问卷按当前形态无法回答研究问题，或会系统性污染关键数据（预设前提无筛选、关键分组变量缺失、诱导性核心测量题）。",
    repairExpectation: "优先修复或调整研究目标；这是方法学建议级别，不自动成为发布硬门禁。结构合法性仍由 core 校验。",
  },
  {
    id: "major",
    name: "严重",
    definition:
      "缺陷损害特定题目的测量质量或样本口径（双重提问、时间参照缺失、选项互斥缺口），受损数据不可复原但范围局部。",
    repairExpectation: "应在预测试前修复；遗留时在发布说明记录为未解决限制。",
  },
  {
    id: "minor",
    name: "一般",
    definition:
      "改进空间（措辞可更具体、题序可优化），不修复不至于破坏测量。",
    repairExpectation: "可带入预测试，结合预测试反馈决定是否修订。",
  },
];

export const REVIEW_PROTOCOL = {
  // 「严重问题」= blocker + major；O2 KR1 的召回/诊断准确率以此为分母口径。
  seriousProblemDefinition:
    "严重问题召回范围为 blocker 与 major；全部诊断的证据支持率另算，minor 与目录外发现也须记账，不得静默排除。",
  diagnosisMatching: {
    rule: "一条诊断与一条标注问题匹配 ⇔ checkId 相同且位置重叠（同一题目 id，或同一页/研究说明等定义路径）。checkId 相同但位置不同的，算两条独立问题，不得因「同类问题」合并计数。",
    dedup: "按规范化问题身份（问题含义 + 精确位置）去重；同一问题命中只算一次。同题不同问题、不同矩阵行/选项不得仅因位置相同合并。一个诊断不得匹配多个标注问题。",
    unmatchable: "目录外发现保留在全部诊断分母，独立审查后记为支持、反对或未决；报告目录外占比。不能因无 checkId 就删除或当作正确。",
  },
  recallPrecision: {
    recall: "只在已有可核验标签的严重缺陷集上计算召回率，并报告标签来源与未决数；Agent 共识标签的结果单列为代理指标，不称专业真值。",
    precision: "已核验标签可计算 precision；Agent 裁决报告证据支持率：下界=支持数/全部去重诊断数，上界=(支持数+未决数)/全部数，同时报告已裁决支持率与裁决覆盖率。分母为零返回不可计算。",
    dedupFirst: "去重后再计算；每条诊断都有支持/反对/未决状态。未决不得从主分母消失，不同问题不能仅因同题而去重。",
  },
  revisionReReview: {
    procedure: "修订复核（O2 KR2）由未参与修订的复核者执行：只给原问题、原问卷与修订后问卷，不给修订者自述。",
    criteria: "判定两项：原问题是否已解决（对照 checkId 与位置）；修订是否引入新的 blocker/major 问题（对照全目录）。两项都过才算「有效修订」。",
  },
  disagreement: {
    initial: "首轮独立上下文审查，不提供作者身份、预期答案、标注理由或其他评审意见；同意也须核查证据，不能仅因一致就锁定真值。",
    adjudication: "裁决者核对原文、适用条件与反例，不按多数票或头衔判定；允许证据不足与分歧未决，记录支持与反对理由。",
    standardChange: "若分歧暴露标准本身歧义（同一条 check 两处解读），修订该 check 的 claim 文字并标注修订原因，评测重跑受影响条目。",
  },
  llmJudgePolicy:
    "没有人类专家团时允许 Agent 承担来源核查、方法审查和反例审查，不以专家到位作为工程前置条件；其结果仅为内部代理证据，不替代真人预测试、专业认证或实际测量表现。角色提示不增加独立专业资质。",
  holdoutPolicy:
    "已被建设者读取的公开案例均为工作集；留出输入与答案须独立存储、冻结哈希与版本，并在执行时隔离评审的答案访问。匿名化现有案例只算盲审试运行，不能恢复真正留出资格。",
  agentReview: {
    roles: ["source_verification", "measurement_review", "counterexample_review"],
    evidence: "每项记录原始来源 URL、段落/页位置、支持的具体主张与适用限制；来源提及该主题不等于支持整条检查。不得杜撰引文。",
    isolation: "生成者、首轮评审与裁决分开上下文；记录实际模型与版本，不把同模型多角色写成跨模型独立验证。首轮提交封存后才交换意见。",
    calibration: "先检查已知错误、合理反例、同义改写与改变关键前提的配对案例；一致率只度量稳定性，不能替代正确率。",
    record: "保留输入/标准哈希、提示词与模型版本、逐项原始输出、裁决理由和未决数；运行记录进任务或 Issue，不将一次性报告放进规则目录。",
  },
  pendingValidation: [
    "SEVERITY_LEVELS 三级定义与「严重问题 = blocker+major」口径。",
    "diagnosisMatching 的位置重叠判定是否足够（是否需要更细的选项级位置）。",
    "首批八维检查条目的 claim 表述与严重级别（目录随专家意见修订）。",
    "[已核验 2026-10-27，独立 Agent 按原始来源逐条核验 60 条检查与全部 planted/mustNotFlag/edge 标签；修正 3 处标签错误、统一 acquiescence 口径、新增 4 例盲区案例——代理证据，人类专家复核仍未发生] 评测集缺陷案例的标注真值（planted 是否确为该 check 的典型表现）。",
  ],
} as const;
