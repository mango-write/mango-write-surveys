// 研究计划构造（纯函数，浏览器端）：把研究设计与所选数据集列清单变成
// SurveyResearchRecipe 序列。researchDesign.analysisModels 是宿主/fleet 渐进落地的
// 结构化字段，这里防御式读取——形状不认识就跳过并计数，绝不让面板崩在未知
// 形状上；没有结构化模型时由面板回落极简角色选择。
import type { SurveyResearchRecipe } from "../../contracts/index.js";
import type { SurveyResearchConstruct } from "../../core/index.js";

const REF_PATTERN = /^(construct|variable):[A-Za-z0-9_.-]+$/;

function isRef(value: unknown): value is string {
  return typeof value === "string" && REF_PATTERN.test(value);
}

function isRefArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isRef);
}

/** 该构念在当前数据集里至少有一个已映射的数值类条目变量，才可进入信度/EFA。 */
export function usableConstructIds(
  constructs: SurveyResearchConstruct[],
  variables: Array<{ id: string; kind: string }>,
  columns: string[],
): string[] {
  const mapped = new Set(columns);
  const numericQuestionIds = new Set(
    variables
      .filter(
        (variable) =>
          (variable.kind === "number" || variable.kind === "ordinal") &&
          mapped.has(variable.id),
      )
      .map((variable) => variable.id.split(".")[0]!),
  );
  return constructs
    .filter((construct) =>
      construct.questionIds.some((questionId) => numericQuestionIds.has(questionId)),
    )
    .map((construct) => construct.id);
}

export function buildModeratedMediationRecipe(input: {
  x: string;
  m: string;
  y: string;
  w: string;
  covariates: string[];
  resamples: number;
  seed: number;
}): Extract<SurveyResearchRecipe, { type: "moderatedMediation" }> {
  return {
    type: "moderatedMediation",
    x: input.x,
    m: input.m,
    y: input.y,
    w: input.w,
    covariates: input.covariates,
    bootstrap: { resamples: input.resamples, seed: input.seed },
  };
}

interface ParsedModels {
  recipes: SurveyResearchRecipe[];
  /** 形状不认识或引用不完整而被跳过的模型数。 */
  ignored: number;
}

/** 官方结构化模型（core SurveyAnalysisModel，按 kind 判别）：调节中介可附带
 *  一个探索性 EFA 检查，一并进计划。 */
function parseOfficialModel(model: Record<string, unknown>): SurveyResearchRecipe[] | null {
  if (model.kind === "efa") {
    const { constructId, factorCount } = model;
    return typeof constructId === "string" &&
      typeof factorCount === "number" &&
      Number.isInteger(factorCount) &&
      factorCount >= 1 &&
      factorCount <= 20
      ? [{ type: "efa", constructIds: [constructId], factorCount }]
      : null;
  }
  if (model.kind !== "moderatedMediation") return null;
  if (![model.x, model.m, model.y, model.w].every(isRef)) return null;
  const covariates = Array.isArray(model.covariates) && model.covariates.every(isRef)
    ? model.covariates.slice(0, 10)
    : [];
  const bootstrap = model.bootstrap;
  const resamples =
    typeof bootstrap === "object" && bootstrap !== null &&
    typeof (bootstrap as Record<string, unknown>).resamples === "number"
      ? Math.round((bootstrap as Record<string, unknown>).resamples as number)
      : 1000;
  const seed =
    typeof bootstrap === "object" && bootstrap !== null &&
    typeof (bootstrap as Record<string, unknown>).seed === "number"
      ? Math.round((bootstrap as Record<string, unknown>).seed as number)
      : 20260902;
  const recipes: SurveyResearchRecipe[] = [];
  const efa = model.efa;
  if (typeof efa === "object" && efa !== null) {
    const record = efa as Record<string, unknown>;
    const { constructId, factorCount } = record;
    if (
      typeof constructId === "string" &&
      typeof factorCount === "number" &&
      Number.isInteger(factorCount) &&
      factorCount >= 1 &&
      factorCount <= 20
    ) {
      recipes.push({ type: "efa", constructIds: [constructId], factorCount });
    }
  }
  recipes.push({
    type: "moderatedMediation",
    x: model.x as string,
    m: model.m as string,
    y: model.y as string,
    w: model.w as string,
    covariates,
    bootstrap: { resamples, seed },
  });
  return recipes;
}

/** 早期/外来形状（type 判别、缺 id 等）的宽容解析：面板不因形状漂移崩溃。 */
function parseLegacyModel(model: Record<string, unknown>): SurveyResearchRecipe[] | null {
  switch (model.type) {
    case "reliability":
      return isRefArray(model.constructIds)
        ? [{ type: "reliability", constructIds: model.constructIds.slice(0, 20) }]
        : null;
    case "efa": {
      const constructIds = isRefArray(model.constructIds)
        ? model.constructIds.slice(0, 20)
        : isRef(model.constructId)
          ? [model.constructId]
          : null;
      const factorCount = model.factorCount;
      return constructIds && typeof factorCount === "number" &&
          Number.isInteger(factorCount) && factorCount >= 1 && factorCount <= 20
        ? [{ type: "efa", constructIds, factorCount }]
        : null;
    }
    case "ols":
      return isRef(model.outcome) && isRefArray(model.predictors)
        ? [
            {
              type: "ols",
              outcome: model.outcome,
              predictors: model.predictors.slice(0, 30),
            },
          ]
        : null;
    case "moderatedMediation": {
      if (![model.x, model.m, model.y, model.w].every(isRef)) return null;
      const covariates = Array.isArray(model.covariates) && model.covariates.every(isRef)
        ? model.covariates.slice(0, 10)
        : [];
      const bootstrap = (() => {
        const value = model.bootstrap;
        if (typeof value !== "object" || value === null) {
          return { resamples: 1000, seed: 20260902 };
        }
        const record = value as Record<string, unknown>;
        return {
          resamples:
            typeof record.resamples === "number" && record.resamples >= 100 && record.resamples <= 5000
              ? Math.round(record.resamples)
              : 1000,
          seed:
            typeof record.seed === "number" && record.seed >= 0 && record.seed <= 0xffffffff
              ? Math.round(record.seed)
              : 20260902,
        };
      })();
      return [
        {
          type: "moderatedMediation",
          x: model.x as string,
          m: model.m as string,
          y: model.y as string,
          w: model.w as string,
          covariates,
          bootstrap,
        },
      ];
    }
    default:
      return null;
  }
}

/** 结构化 analysisModels → 可直接提交的配方序列；每个条目独立解析，坏条目
 *  只跳过不中断（ignored 计数供面板提示「有 N 个模型无法识别」）。 */
export function parseAnalysisModels(value: unknown): ParsedModels {
  if (!Array.isArray(value)) return { recipes: [], ignored: 0 };
  const recipes: SurveyResearchRecipe[] = [];
  let ignored = 0;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      ignored += 1;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const parsed = parseOfficialModel(record) ?? parseLegacyModel(record);
    if (parsed) recipes.push(...parsed);
    else ignored += 1;
  }
  return { recipes, ignored };
}

/** 一键研究计划：信度 + EFA 覆盖全部可用构念，随后按顺序执行结构化模型。
 *  没有可用构念且没有结构化模型时返回空（面板据此回落角色选择）。 */
export function buildResearchPlan(input: {
  usableConstructIds: string[];
  analysisModels: unknown;
}): SurveyResearchRecipe[] {
  const plan: SurveyResearchRecipe[] = [];
  const constructs = input.usableConstructIds.slice(0, 20);
  const { recipes } = parseAnalysisModels(input.analysisModels);
  if (constructs.length > 0) {
    plan.push({ type: "reliability", constructIds: constructs });
    if (!recipes.some((recipe) => recipe.type === "efa")) {
      plan.push({
        type: "efa",
        constructIds: constructs,
        factorCount: Math.min(constructs.length, 20),
      });
    }
  }
  const seen = new Set(plan.map(recipeKey));
  for (const recipe of recipes) {
    const key = recipeKey(recipe);
    if (!seen.has(key)) {
      seen.add(key);
      plan.push(recipe);
    }
  }
  return plan;
}

/** 计划里是否含调节中介：决定一键按钮的完成度提示（缺 MM 时引导角色选择）。 */
export function planHasModeratedMediation(plan: SurveyResearchRecipe[]): boolean {
  return plan.some((recipe) => recipe.type === "moderatedMediation");
}

/** 去重键：引用统一剥掉 `construct:`/`variable:` 前缀后比较，结构化模型里
 *  带前缀的 reliability/efa 与派生的裸 id 版本视为同一次运行。 */
function recipeKey(recipe: SurveyResearchRecipe): string {
  return JSON.stringify(recipe, (_key, value) =>
    typeof value === "string" ? value.replace(/^(construct|variable):/, "") : value,
  );
}
