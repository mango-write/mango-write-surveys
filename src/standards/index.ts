// 研究标准目录装配（主仓 issue #224 阶段 1）：聚合八个维度的检查项与首批
// 研究类型。消费方（阶段 2 生成理由、阶段 3 诊断、评测集引用）只从这里拿，
// 不直接 import 维度文件。评测集见 ./eval。
import type { StandardsCheck } from "./schema.js";
import { researchGoalChecks } from "./checks/research_goal.js";
import { samplingRecruitmentChecks } from "./checks/sampling_recruitment.js";
import { coverageChecks } from "./checks/coverage.js";
import { wordingChecks } from "./checks/wording.js";
import { optionsChecks } from "./checks/options.js";
import { flowChecks } from "./checks/flow.js";
import { burdenChecks } from "./checks/burden.js";
import { analysisFitChecks } from "./checks/analysis_fit.js";
import { RESEARCH_TYPES } from "./research-types.js";

export * from "./schema.js";
export { RESEARCH_TYPES };
export * from "./review-protocol.js";

export const STANDARDS_CHECKS: StandardsCheck[] = [
  ...researchGoalChecks,
  ...samplingRecruitmentChecks,
  ...coverageChecks,
  ...wordingChecks,
  ...optionsChecks,
  ...flowChecks,
  ...burdenChecks,
  ...analysisFitChecks,
];
