// 标准正文归 standards，此处只投影目录与按 ID 查询详情。
import {
  REVIEW_PROTOCOL,
  REVIEW_PROTOCOL_STATUS,
  SEVERITY_LEVELS,
  STANDARDS_CHECKS,
  type StandardsCheck,
} from "../standards/index.js";

/** 诊断的身份声明：任何工具回执与 AI 输出都不得把它说成真人验证。 */
export const AGENT_REVIEW_DISCLAIMER =
  "AI 方法审查是内部代理证据：不代表真人预测试、信效度验证或专业认证，也不证明问卷可发布。";

export const STANDARDS_CHECK_IDS: readonly string[] = STANDARDS_CHECKS.map(
  (check) => check.id,
);

export interface StandardsCheckBrief {
  id: string;
  title: string;
  dimension: string;
  severity: string;
  classification: string;
  researchTypes?: string[];
  questionTypes?: string[];
}

export interface StandardsDigest {
  status: string;
  disclaimer: string;
  severity: Array<{ id: string; name: string; definition: string }>;
  checks: StandardsCheckBrief[];
  matchingRule: string;
  unmatchable: string;
}

export function compactStandardsDigest(): StandardsDigest {
  return {
    status: REVIEW_PROTOCOL_STATUS,
    disclaimer: AGENT_REVIEW_DISCLAIMER,
    severity: SEVERITY_LEVELS.map((level) => ({
      id: level.id,
      name: level.name,
      definition: level.definition,
    })),
    checks: STANDARDS_CHECKS.map((check) => ({
      id: check.id,
      title: check.title,
      dimension: check.dimension,
      severity: check.severity.level,
      classification: check.classification,
      ...(check.appliesTo.researchTypes
        ? { researchTypes: check.appliesTo.researchTypes }
        : {}),
      ...(check.appliesTo.questionTypes
        ? { questionTypes: check.appliesTo.questionTypes }
        : {}),
    })),
    matchingRule: REVIEW_PROTOCOL.diagnosisMatching.rule,
    unmatchable: REVIEW_PROTOCOL.diagnosisMatching.unmatchable,
  };
}

export interface StandardsDetailResult {
  checks: StandardsCheck[];
  unknownCheckIds: string[];
}

/** 按 id 取完整检查项（claim/citations/errorExample/handling）；未知 id 如实回告。 */
export function standardsCheckDetail(checkIds: readonly string[]): StandardsDetailResult {
  const wanted = new Set(checkIds);
  const found = STANDARDS_CHECKS.filter((check) => wanted.has(check.id));
  const known = new Set(found.map((check) => check.id));
  return {
    checks: found,
    unknownCheckIds: [...wanted].filter((id) => !known.has(id)),
  };
}
