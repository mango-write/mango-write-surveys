// 严重程度、诊断评测口径与复核规则（主仓 issue #224 阶段 1 第四项的规则
// 部分）。状态是草案：专家审核（调查方法/心理测量）未完成前不得宣称已
// 通过专业验收；O2 指标的分母分子都在这里定义，报告必须照此计算。
import type { CheckSeverity } from "./schema.js";

export const REVIEW_PROTOCOL_STATUS = "draft-pending-expert-review" as const;

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
    repairExpectation: "进入真人预测试前必须修复；不修复不得发布采集。",
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
    "blocker 与 major 两级之和；minor 不计入 O2 KR1 的严重问题召回与准确率。",
  diagnosisMatching: {
    rule: "一条诊断与一条标注问题匹配 ⇔ checkId 相同且位置重叠（同一题目 id，或同一页/研究说明等定义路径）。checkId 相同但位置不同的，算两条独立问题，不得因「同类问题」合并计数。",
    dedup: "同一问题被多条诊断命中只算一次召回命中；同一诊断不得匹配多条标注问题来抬高召回。",
    unmatchable: "诊断引用了目录外的自由发挥问题类型时单独列为「目录外发现」，交专家判定是否应入目录，不计入 precision 分母。",
  },
  recallPrecision: {
    recall: "召回率 = 被至少一条诊断匹配的严重标注问题数 / 严重标注问题总数。",
    precision: "诊断准确率 = 经独立复核确认为真问题的诊断数 / 全部诊断数；复核者看得到诊断原文与问卷原文，看不到诊断来源。",
    dedupFirst: "同一位置的重复诊断先去重再计算 precision，避免同一真问题被报三次把 precision 拉高或拉低。",
  },
  revisionReReview: {
    procedure: "修订复核（O2 KR2）由未参与修订的复核者执行：只给原问题、原问卷与修订后问卷，不给修订者自述。",
    criteria: "判定两项：原问题是否已解决（对照 checkId 与位置）；修订是否引入新的 blocker/major 问题（对照全目录）。两项都过才算「有效修订」。",
  },
  disagreement: {
    initial: "标注与复核各自独立完成后对照；一致即锁定，不一致进仲裁。",
    adjudication: "分歧由第三位专家仲裁；仲裁只判「是否成立 + 严重级别」，不改判定标准本身；仲裁结论记录在案。",
    standardChange: "若分歧暴露标准本身歧义（同一条 check 两处解读），修订该 check 的 claim 文字并标注修订原因，评测重跑受影响条目。",
  },
  llmJudgePolicy:
    "LLM 评分只能作辅助初筛（如批量标注候选缺陷），不得独立证明专业性；O2 各 KR 的最终计数以人工独立复核为准。",
  holdoutPolicy:
    "评测集分工作集与冻结留出集：调优与迭代只对工作集；留出集仅在基线测量与阶段验收时使用，使用记录在案。冻结前由非建设者确认盲化。",
  pendingExpertConfirmation: [
    "SEVERITY_LEVELS 三级定义与「严重问题 = blocker+major」口径。",
    "diagnosisMatching 的位置重叠判定是否足够（是否需要更细的选项级位置）。",
    "首批八维检查条目的 claim 表述与严重级别（目录随专家意见修订）。",
    "评测集缺陷案例的标注真值（planted 是否确为该 check 的典型表现）。",
  ],
} as const;
