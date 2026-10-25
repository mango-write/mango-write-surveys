import type {
  SurveyResearchRecipe,
  SurveyResearchResult,
  SurveyResearchTable,
} from "../contracts/index.js";
import {
  surveyVariables,
  type SurveyAnalysisModel,
  type SurveyColumnVariable,
  type SurveyResearchConstruct,
} from "../core/index.js";
import { SurveyError } from "../server/errors.js";

import { numericCategoricalOptions } from "./dataset.js";
import {
  completeCases,
  createSeededRandom,
  cronbachAlpha,
  fitOlsHc3,
  fitOlsPoint,
  percentile,
  principalAxisEfa,
  sampleStandardDeviation,
  standardize,
  studentTCdf,
  studentTQuantile,
  type NumericVariable,
  type OlsResult,
} from "./statistics.js";
import type { ResearchAnalysisInput } from "./types.js";

export const RESEARCH_ENGINE_VERSION = "research-engine-v1";

function table(
  id: string,
  title: string,
  columns: Array<[string, string]>,
  rows: Array<Record<string, string | number | null>>,
): SurveyResearchTable {
  return {
    id,
    title,
    columns: columns.map(([key, label]) => ({ key, label })),
    rows,
  };
}

function constructItems(
  construct: SurveyResearchConstruct,
  variables: SurveyColumnVariable[],
  mappedIds: Set<string>,
): SurveyColumnVariable[] {
  const questionIds = new Set(construct.questionIds);
  const items = variables.filter(
    (variable) =>
      questionIds.has(variable.questionId) &&
      mappedIds.has(variable.id) &&
      (variable.kind === "number" || variable.kind === "ordinal"),
  );
  if (items.length === 0)
    throw new SurveyError(
      "invalid_recipe",
      422,
      `构念 ${construct.id} 没有已映射的 number/ordinal 变量`,
    );
  return items;
}

/** 反题按已发布 codebook 的取值范围反向：min+max-original（矩阵行内单条反转）。 */
function reversedValue(item: SurveyColumnVariable, value: number): number {
  const numericOptions = item.options?.map((option) => Number(option.id)).filter(Number.isFinite);
  if (!numericOptions || numericOptions.length === 0)
    throw new SurveyError("invalid_recipe", 422, `反题 ${item.id} 缺少可确定的 ordinal 取值范围`);
  return Math.min(...numericOptions) + Math.max(...numericOptions) - value;
}

function scoreConstruct(
  construct: SurveyResearchConstruct,
  variables: SurveyColumnVariable[],
  rows: Array<Record<string, number | null>>,
): NumericVariable {
  const items = constructItems(
    construct,
    variables,
    new Set(Object.keys(rows[0] ?? {})),
  );
  const scoring = construct.scoring ?? {
    method: "mean" as const,
    reverseVariableIds: [],
    minValid: 1,
  };
  if (scoring.minValid > items.length)
    throw new SurveyError("invalid_recipe", 422, `构念 ${construct.id} 的 minValid 超过题目数`);
  const reversed = new Set(scoring.reverseVariableIds);
  for (const variableId of reversed)
    if (!items.some((item) => item.id === variableId))
      throw new SurveyError("invalid_recipe", 422, `反题 ${variableId} 不属于构念 ${construct.id}`);
  const values = rows.map((row) => {
    const scored = items.flatMap((item) => {
      const original = row[item.id];
      if (typeof original !== "number") return [];
      return reversed.has(item.id) ? [reversedValue(item, original)] : [original];
    });
    if (scored.length < scoring.minValid) return null;
    const total = scored.reduce((sum, value) => sum + value, 0);
    return scoring.method === "mean" ? total / scored.length : total;
  });
  return { id: `construct:${construct.id}`, label: construct.label, values };
}

interface AnalysisContext {
  constructs: SurveyResearchConstruct[];
  variables: SurveyColumnVariable[];
  rows: Array<Record<string, number | null>>;
}

/** number/ordinal，或选项 id 全为有限数值的 categorical（如 gender=1/2）可进模型。 */
function numericVariable(variable: SurveyColumnVariable): boolean {
  return (
    variable.kind === "number" ||
    variable.kind === "ordinal" ||
    numericCategoricalOptions(variable) !== null
  );
}

function resolveRef(ref: string, context: AnalysisContext): NumericVariable {
  if (ref.startsWith("variable:")) {
    const id = ref.slice("variable:".length);
    const variable = context.variables.find((candidate) => candidate.id === id);
    if (!variable || !numericVariable(variable))
      throw new SurveyError("invalid_recipe", 422, `变量 ${id} 不是可建模的数值变量`);
    if (!Object.hasOwn(context.rows[0] ?? {}, id))
      throw new SurveyError("invalid_recipe", 422, `变量 ${id} 未映射到数据集`);
    return {
      id: ref,
      label: variable.label,
      values: context.rows.map((row) => row[id] ?? null),
    };
  }
  const construct = context.constructs.find((candidate) => `construct:${candidate.id}` === ref);
  if (!construct) throw new SurveyError("invalid_recipe", 422, `未知构念引用 ${ref}`);
  return scoreConstruct(construct, context.variables, context.rows);
}

function requireConstructs(ids: string[], context: AnalysisContext): SurveyResearchConstruct[] {
  return ids.map((id) => {
    const construct = context.constructs.find((candidate) => candidate.id === id);
    if (!construct) throw new SurveyError("invalid_recipe", 422, `未知构念 ${id}`);
    return construct;
  });
}

function mappingTable(context: AnalysisContext, constructs: SurveyResearchConstruct[]): SurveyResearchTable {
  return table(
    "variable_mapping",
    "量表与变量映射",
    [
      ["construct", "构念"],
      ["variable", "变量"],
      ["label", "题目"],
      ["scoring", "计分"],
      ["reverse", "反向计分"],
    ],
    constructs.flatMap((construct) => {
      const items = constructItems(
        construct,
        context.variables,
        new Set(Object.keys(context.rows[0] ?? {})),
      );
      const scoring = construct.scoring ?? { method: "mean", reverseVariableIds: [], minValid: 1 };
      return items.map((item) => ({
        construct: construct.label,
        variable: item.id,
        label: item.label,
        scoring: `${scoring.method}; minValid=${scoring.minValid}`,
        reverse: scoring.reverseVariableIds.includes(item.id) ? "是" : "否",
      }));
    }),
  );
}

const crossSectionalLimitation = "横断面数据只支持关联与统计分解，不支持因果、时间顺序或中介机制结论。";
const generalLimitations = [
  crossSectionalLimitation,
  "分析按各模型完整病例执行，缺失不填零、不插补；结果可能受非随机缺失影响。",
];

function reliabilityAnalysis(context: AnalysisContext, constructIds: string[]): SurveyResearchResult {
  const constructs = requireConstructs(constructIds, context);
  const rows: Array<Record<string, string | number | null>> = [];
  let effectiveN = Number.POSITIVE_INFINITY;
  let missingRows = 0;
  for (const construct of constructs) {
    const items = constructItems(
      construct,
      context.variables,
      new Set(Object.keys(context.rows[0] ?? {})),
    );
    const reversed = new Set(construct.scoring?.reverseVariableIds ?? []);
    // 反题逐条反转后进信度：不能按「整题求和」代理——矩阵题一个问多条变量，
    // 求和会把题目维度混进条目方差，raw alpha 静默失真。
    const variables = items.map((item) => ({
      id: item.id,
      label: item.label,
      values: context.rows.map((row) => {
        const original = row[item.id];
        if (typeof original !== "number") return null;
        return reversed.has(item.id) ? reversedValue(item, original) : original;
      }),
    }));
    const complete = completeCases(variables, context.rows.length);
    effectiveN = Math.min(effectiveN, complete.values.length);
    missingRows = Math.max(missingRows, complete.missingRows);
    rows.push({
      construct: construct.label,
      items: items.length,
      n: complete.values.length,
      missing: complete.missingRows,
      rawAlpha: cronbachAlpha(complete.values),
    });
  }
  return {
    method: "Cronbach raw alpha；反向题先按已发布 codebook 的取值范围反向，按构念 listwise。",
    effectiveN,
    missingRows,
    tables: [
      mappingTable(context, constructs),
      table("reliability", "信度", [["construct", "构念"], ["items", "题数"], ["n", "有效 n"], ["missing", "缺失行"], ["rawAlpha", "Raw alpha"]], rows),
    ],
    warnings: ["较高 alpha 不证明单维性、结构效度或量表质量，也不能替代内容效度与外部验证。"],
    limitations: generalLimitations,
    chart: null,
  };
}

function efaAnalysis(
  context: AnalysisContext,
  constructIds: string[],
  factorCount: number,
): SurveyResearchResult {
  const constructs = requireConstructs(constructIds, context);
  const variables = constructs.flatMap((construct) =>
    constructItems(construct, context.variables, new Set(Object.keys(context.rows[0] ?? {}))).map(
      (item) => ({ id: item.id, label: item.label, values: context.rows.map((row) => row[item.id] ?? null) }),
    ),
  );
  const unique = [...new Map(variables.map((variable) => [variable.id, variable])).values()];
  const complete = completeCases(unique, context.rows.length);
  const result = principalAxisEfa(complete.values, factorCount);
  return {
    method: `Principal-axis exploratory factor analysis（主轴因子迭代，初始共同度为 squared multiple correlations，${factorCount} 因子${factorCount > 1 ? "，varimax 旋转" : ""}）；不是 PCA。`,
    effectiveN: complete.values.length,
    missingRows: complete.missingRows,
    tables: [
      mappingTable(context, constructs),
      table("efa_fit", "结构效度诊断", [["statistic", "指标"], ["value", "值"]], [
        { statistic: "KMO", value: result.kmo },
        { statistic: "Bartlett chi-square", value: result.bartlettChiSquare },
        { statistic: "Bartlett df", value: result.bartlettDf },
        { statistic: "Bartlett p", value: result.bartlettPValue },
      ]),
      table("efa_variance", "解释方差", [["factor", "因子"], ["varianceExplained", "提取载荷平方和 / 题数"]], result.varianceExplained.map((value, index) => ({ factor: index + 1, varianceExplained: value }))),
      table("efa_loadings", "因子载荷与共同度", [["variable", "变量"], ...Array.from({ length: factorCount }, (_, i): [string, string] => [`factor${i + 1}`, `因子 ${i + 1}`]), ["communality", "共同度"]], unique.map((variable, row) => ({
        variable: variable.id,
        ...Object.fromEntries(Array.from({ length: factorCount }, (_, factor) => [`factor${factor + 1}`, result.loadings[row]![factor]!])),
        communality: result.communalities[row]!,
      }))),
    ],
    warnings: ["EFA 是探索性证据；KMO/Bartlett 与载荷不证明理论结构成立，因子数与命名仍需理论和独立样本验证。"],
    limitations: generalLimitations,
    chart: null,
  };
}

function olsSummaryTables(model: OlsResult, title: string): SurveyResearchTable[] {
  return [
    table("coefficients", title, [["term", "项"], ["estimate", "非标准化系数"], ["stdError", "HC3 SE"], ["statistic", "t"], ["pValue", "p"], ["ciLow", "95% CI 下限"], ["ciHigh", "95% CI 上限"]], model.terms.map((term) => ({ ...term }))),
    table("model_fit", "模型拟合与诊断", [["statistic", "指标"], ["value", "值"]], [
      { statistic: "n", value: model.n },
      { statistic: "Residual df", value: model.dfResidual },
      { statistic: "R²", value: model.r2 },
      { statistic: "Adjusted R²", value: model.adjustedR2 },
      { statistic: "Cohen f²", value: model.cohenF2 },
      { statistic: "Max VIF", value: model.maxVif },
    ]),
  ];
}

function olsAnalysis(context: AnalysisContext, outcomeRef: string, predictorRefs: string[]): SurveyResearchResult {
  const outcome = resolveRef(outcomeRef, context);
  const predictors = predictorRefs.map((ref) => resolveRef(ref, context));
  const complete = completeCases([outcome, ...predictors], context.rows.length);
  const model = fitOlsHc3(
    complete.values.map((row) => row.slice(1)),
    complete.values.map((row) => row[0]!),
    predictors.map((predictor) => predictor.id),
  );
  const constructs = context.constructs.filter((construct) =>
    [outcomeRef, ...predictorRefs].includes(`construct:${construct.id}`),
  );
  const tables = olsSummaryTables(model, "OLS（HC3 稳健标准误）");
  if (constructs.length > 0) tables.unshift(mappingTable(context, constructs));
  return {
    method: "非标准化 OLS；HC3 异方差稳健标准误、t 检验与 95% 置信区间。",
    effectiveN: complete.values.length,
    missingRows: complete.missingRows,
    tables,
    warnings: [],
    limitations: generalLimitations,
    chart: null,
  };
}

function bootstrapSummary(estimate: number, samples: number[]): {
  estimate: number;
  bootstrapSE: number;
  ciLow: number;
  ciHigh: number;
} {
  return {
    estimate,
    bootstrapSE: sampleStandardDeviation(samples),
    ciLow: percentile(samples, 0.025),
    ciHigh: percentile(samples, 0.975),
  };
}

function moderatedMediationAnalysis(
  context: AnalysisContext,
  recipe: Extract<SurveyResearchRecipe, { type: "moderatedMediation" }>,
): SurveyResearchResult {
  const refs = [recipe.x, recipe.m, recipe.y, recipe.w, ...recipe.covariates];
  const variables = refs.map((ref) => resolveRef(ref, context));
  const complete = completeCases(variables, context.rows.length);
  const standardized = complete.values.map((row, rowIndex) =>
    row.map((_, column) => {
      const values = complete.values.map((candidate) => candidate[column]!);
      const unique = new Set(values);
      return column < 4 || unique.size > 2
        ? standardize(values)[rowIndex]!
        : values[rowIndex]!;
    }),
  );
  const covariateNames = recipe.covariates.map((ref) => ref.replace(/^(construct|variable):/, ""));
  const mediator = fitOlsHc3(
    standardized.map((row) => [row[0]!, ...row.slice(4)]),
    standardized.map((row) => row[1]!),
    ["X", ...covariateNames],
  );
  const outcomePredictors = standardized.map((row) => [row[0]!, row[1]!, row[3]!, row[1]! * row[3]!, ...row.slice(4)]);
  const outcome = fitOlsHc3(outcomePredictors, standardized.map((row) => row[2]!), ["X", "M", "W", "M:W", ...covariateNames]);
  const a = mediator.coefficients[1]!;
  const b = outcome.coefficients[2]!;
  const interaction = outcome.coefficients[4]!;
  const pointEstimates = [a * (b - interaction), a * b, a * (b + interaction), 2 * a * interaction, a * interaction];
  const random = createSeededRandom(recipe.bootstrap.seed);
  const samples: number[][] = Array.from({ length: 5 }, () => []);
  for (let draw = 0; draw < recipe.bootstrap.resamples; draw += 1) {
    const resampled = Array.from({ length: standardized.length }, () => standardized[Math.floor(random() * standardized.length)]!);
    const aModel = fitOlsPoint(resampled.map((row) => [row[0]!, ...row.slice(4)]), resampled.map((row) => row[1]!));
    const bModel = fitOlsPoint(resampled.map((row) => [row[0]!, row[1]!, row[3]!, row[1]! * row[3]!, ...row.slice(4)]), resampled.map((row) => row[2]!));
    const bootA = aModel[1]!;
    const bootB = bModel[2]!;
    const bootInteraction = bModel[4]!;
    const effects = [bootA * (bootB - bootInteraction), bootA * bootB, bootA * (bootB + bootInteraction), 2 * bootA * bootInteraction, bootA * bootInteraction];
    effects.forEach((effect, index) => samples[index]!.push(effect));
  }
  const effectNames = ["W=-1 条件间接效应", "W=0 条件间接效应", "W=+1 条件间接效应", "高低条件差", "调节中介指数 a×interaction"];
  const effects = pointEstimates.map((estimate, index) => ({ effect: effectNames[index]!, ...bootstrapSummary(estimate, samples[index]!) }));
  const critical = studentTQuantile(0.975, outcome.dfResidual);
  const slopes = [-1, 0, 1].map((level) => {
    const estimate = b + interaction * level;
    const variance = outcome.covariance[2]![2]! + level ** 2 * outcome.covariance[4]![4]! + 2 * level * outcome.covariance[2]![4]!;
    const stdError = Math.sqrt(Math.max(0, variance));
    const statistic = estimate / stdError;
    return { moderatorLevel: level, estimate, stdError, statistic, pValue: 2 * (1 - studentTCdf(Math.abs(statistic), outcome.dfResidual)), ciLow: estimate - critical * stdError, ciHigh: estimate + critical * stdError };
  });
  const constructs = context.constructs.filter((construct) => refs.includes(`construct:${construct.id}`));
  return {
    method: `X/M/Y/W 与连续协变量按样本均值和样本 SD 标准化，二分类协变量保持原编码；M~X+covariates，Y~X+M+W+M:W+covariates。条件间接效应与调节中介指数采用固定 seed 的 ${recipe.bootstrap.resamples} 次成对非参数 percentile bootstrap。`,
    effectiveN: complete.values.length,
    missingRows: complete.missingRows,
    tables: [
      ...(constructs.length ? [mappingTable(context, constructs)] : []),
      table("mediator_model", "中介方程（HC3）", [["term", "项"], ["estimate", "系数"], ["stdError", "HC3 SE"], ["pValue", "p"], ["ciLow", "95% CI 下限"], ["ciHigh", "95% CI 上限"]], mediator.terms.map((term) => ({ ...term }))),
      table("outcome_model", "结果方程（HC3）", [["term", "项"], ["estimate", "系数"], ["stdError", "HC3 SE"], ["pValue", "p"], ["ciLow", "95% CI 下限"], ["ciHigh", "95% CI 上限"]], outcome.terms.map((term) => ({ ...term }))),
      table("conditional_indirect", "Bootstrap 条件间接效应", [["effect", "效应"], ["estimate", "估计"], ["bootstrapSE", "Bootstrap SE"], ["ciLow", "Percentile 95% CI 下限"], ["ciHigh", "Percentile 95% CI 上限"]], effects),
      table("simple_slopes", "M 的简单斜率", [["moderatorLevel", "W 水平（SD）"], ["estimate", "斜率"], ["stdError", "HC3 SE"], ["statistic", "t"], ["pValue", "p"], ["ciLow", "95% CI 下限"], ["ciHigh", "95% CI 上限"]], slopes),
      table("model_fit", "模型诊断", [["statistic", "指标"], ["value", "值"]], [
        { statistic: "Mediator R²", value: mediator.r2 }, { statistic: "Mediator adjusted R²", value: mediator.adjustedR2 }, { statistic: "Mediator Cohen f²", value: mediator.cohenF2 }, { statistic: "Mediator max VIF", value: mediator.maxVif },
        { statistic: "Outcome R²", value: outcome.r2 }, { statistic: "Outcome adjusted R²", value: outcome.adjustedR2 }, { statistic: "Outcome Cohen f²", value: outcome.cohenF2 }, { statistic: "Outcome max VIF", value: outcome.maxVif },
        { statistic: "Bootstrap seed", value: recipe.bootstrap.seed }, { statistic: "Bootstrap resamples", value: recipe.bootstrap.resamples },
      ]),
    ],
    warnings: ["Bootstrap 区间反映抽样不确定性，不把统计上的间接效应或调节中介指数解释为因果机制。"],
    limitations: generalLimitations,
    chart: null,
  };
}

/**
 * 结构化分析模型 → 可执行 recipe 列表。一个 run 对应一个 recipe，因此附带 EFA
 * 的 moderatedMediation 模型展开为主分析 + EFA 两个 run（主分析在前）。
 */
export function analysisModelRecipes(model: SurveyAnalysisModel): SurveyResearchRecipe[] {
  if (model.kind === "efa")
    return [{ type: "efa", constructIds: [model.constructId], factorCount: model.factorCount }];
  const moderatedMediation: Extract<SurveyResearchRecipe, { type: "moderatedMediation" }> = {
    type: "moderatedMediation",
    x: model.x,
    m: model.m,
    y: model.y,
    w: model.w,
    covariates: model.covariates,
    bootstrap: model.bootstrap,
  };
  if (!model.efa) return [moderatedMediation];
  return [
    moderatedMediation,
    { type: "efa", constructIds: [model.efa.constructId], factorCount: model.efa.factorCount },
  ];
}

export function runResearchAnalysis(input: ResearchAnalysisInput): SurveyResearchResult {
  const context: AnalysisContext = {
    constructs: input.definition.researchDesign?.constructs ?? [],
    variables: surveyVariables(input.definition),
    rows: input.dataset.normalizedRows,
  };
  switch (input.recipe.type) {
    case "reliability":
      return reliabilityAnalysis(context, input.recipe.constructIds);
    case "efa":
      return efaAnalysis(context, input.recipe.constructIds, input.recipe.factorCount);
    case "ols":
      return olsAnalysis(context, input.recipe.outcome, input.recipe.predictors);
    case "moderatedMediation":
      return moderatedMediationAnalysis(context, input.recipe);
  }
}
