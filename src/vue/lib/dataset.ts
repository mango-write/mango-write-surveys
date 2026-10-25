// 数据段的客户端数据集投影（issue #223 拆分）：独立站没有 research-data 服务，
// 答卷列表与逐题摘要所需的展开变量/单元格值在浏览器端从 codebook + 答卷构建，
// 展开与取值口径复用包 core 的 surveyVariablesOf/surveyCellValue/evaluateSurveyPath
// （与主站服务端的 projectSurveyDataset 同源）。列清单以 codebook 为准——它是
// 服务端按该发布版本定义投影的权威口径；行取值、可见性与题型同样只使用
// codebook 携带的不可变发布定义。
import type {
  SurveyCodebook,
  SurveyDefinition,
  SurveyQuestionType,
  SurveyResponseView,
} from "../../contracts/index.js";
import {
  evaluateSurveyPath,
  surveyCellValue,
  surveyVariablesOf,
} from "../../core/index.js";

export type SurveyDatasetValue = string | number | string[] | null;

export interface SurveyDatasetVariable {
  id: string;
  label: string;
  kind: "categorical" | "multiple" | "number" | "ordinal" | "text" | "date";
  options?: Array<{ id: string; label: string }>;
}

export interface SurveyDatasetRow {
  responseId: string;
  values: Record<string, SurveyDatasetValue>;
  missing: Record<string, "unanswered" | "not_displayed">;
}

export interface SurveyDataset {
  surveyId: string;
  revisionId: string;
  title: string;
  variables: SurveyDatasetVariable[];
  rows: SurveyDatasetRow[];
  responseCount: number;
  /** questionId → 该定义的真实题型；摘要按它判型，缺失时回落形状推断。 */
  questionTypes?: Record<string, SurveyQuestionType>;
}

/** 答卷列表里标记的样本排除；研究面板经扩展缝原样承接进配方。 */
export interface SurveySampleExclusion {
  responseId: string;
  reason: string;
}

/** codebook 的 kind 在 wire 契约上是宽松 string；取值域由包 core 的展开口径
 *  保证（变量字典与 surveyVariablesOf 同源），这里收窄为包内联合类型。 */
export function toDatasetVariables(
  variables: SurveyCodebook["variables"],
): SurveyDatasetVariable[] {
  return variables.map((variable) => ({
    ...variable,
    kind: variable.kind as SurveyDatasetVariable["kind"],
  }));
}

export function buildSurveyDataset(input: {
  surveyId: string;
  revisionId: string;
  title: string;
  definition: SurveyDefinition;
  variables: SurveyDatasetVariable[];
  responses: SurveyResponseView[];
}): SurveyDataset {
  const { definition } = input;
  return {
    surveyId: input.surveyId,
    revisionId: input.revisionId,
    title: input.title,
    variables: input.variables,
    rows: input.responses.map((response) => projectRow(definition, response)),
    responseCount: input.responses.length,
    questionTypes: Object.fromEntries(
      definition.questions.map((question) => [question.id, question.type]),
    ),
  };
}

function projectRow(
  definition: SurveyDefinition,
  response: SurveyResponseView,
): SurveyDatasetRow {
  // 可见性按完整最终答案重算（与主站服务端同口径）：隐藏题的答案不参与投影，
  // 「未展示」与「未回答」是两种缺失，互相顶代会把分支带来的无答案伪装成拒答。
  const visible = new Set(
    evaluateSurveyPath(definition, response.answers).questionIds,
  );
  const values: Record<string, SurveyDatasetValue> = {};
  const missing: SurveyDatasetRow["missing"] = {};
  for (const question of definition.questions) {
    const variables = surveyVariablesOf(question);
    if (!visible.has(question.id)) {
      for (const variable of variables) missing[variable.id] = "not_displayed";
      continue;
    }
    const answer = response.answers[question.id];
    if (answer === undefined) {
      for (const variable of variables) missing[variable.id] = "unanswered";
      continue;
    }
    for (const variable of variables) {
      const value = surveyCellValue(question, variable.id, answer);
      if (value !== null) values[variable.id] = value;
    }
  }
  return { responseId: response.id, values, missing };
}
