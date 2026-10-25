import { describe, expect, it } from "vitest";

import type {
  ResearchRunDetail,
  SurveyResearchRecipe,
  SurveyResearchTable,
} from "../contracts/index.js";

import { buildResearchChartSpecs } from "./chart-spec.js";

function table(
  id: string,
  columns: string[],
  rows: Array<Record<string, string | number | null>>,
): SurveyResearchTable {
  return {
    id,
    title: id,
    columns: columns.map((key) => ({ key, label: key })),
    rows,
  };
}

function run(
  recipe: SurveyResearchRecipe,
  tables: SurveyResearchTable[],
): Pick<ResearchRunDetail, "recipe" | "result"> {
  return {
    recipe,
    result: {
      method: "test",
      effectiveN: 20,
      missingRows: 0,
      tables,
      warnings: [],
      limitations: [],
      chart: null,
    },
  };
}

describe("buildResearchChartSpecs", () => {
  it("projects real Cronbach alpha values into a horizontal bar chart", () => {
    const specs = buildResearchChartSpecs(
      run({ type: "reliability", constructIds: ["c1"] }, [
        table(
          "reliability",
          ["construct", "rawAlpha"],
          [
            { construct: "Satisfaction", rawAlpha: 0.82 },
            { construct: "Trust", rawAlpha: null },
          ],
        ),
      ]),
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ id: "reliability-alpha" });
    expect(specs[0]?.option.series).toMatchObject([
      { type: "bar", data: [0.82] },
    ]);
    expect(specs[0]?.option.yAxis).toMatchObject({ data: ["Satisfaction"] });
  });

  it("projects EFA variance and loadings without inventing a scree chart", () => {
    const specs = buildResearchChartSpecs(
      run({ type: "efa", constructIds: ["c1"], factorCount: 2 }, [
        table(
          "variable_mapping",
          ["variable", "label"],
          [{ variable: "q1", label: "Readable item" }],
        ),
        table(
          "efa_variance",
          ["factor", "varianceExplained"],
          [
            { factor: 1, varianceExplained: 0.4 },
            { factor: 2, varianceExplained: 0.2 },
          ],
        ),
        table(
          "efa_loadings",
          ["variable", "factor1", "factor2", "communality"],
          [{ variable: "q1", factor1: 0.7, factor2: -0.1, communality: 0.5 }],
        ),
      ]),
    );
    expect(specs.map((spec) => spec.id)).toEqual([
      "efa-variance",
      "efa-loadings",
    ]);
    expect(specs.some((spec) => spec.id.includes("scree"))).toBe(false);
    expect(specs[1]?.option.series).toMatchObject([
      {
        type: "heatmap",
        data: [
          [0, 0, 0.7],
          [1, 0, -0.1],
          [2, 0, 0.5],
        ],
      },
    ]);
    expect(specs[1]?.option.yAxis).toMatchObject({ data: ["Readable item"] });
  });

  it("projects OLS estimates and both CI bounds into a forest plot", () => {
    const specs = buildResearchChartSpecs(
      run(
        { type: "ols", outcome: "construct:y", predictors: ["construct:x"] },
        [
          table(
            "coefficients",
            ["term", "estimate", "ciLow", "ciHigh"],
            [{ term: "construct:x", estimate: 0.4, ciLow: 0.1, ciHigh: 0.7 }],
          ),
        ],
      ),
    );
    expect(specs).toHaveLength(1);
    expect((specs[0]?.option.series as unknown[])[0]).toMatchObject({
      type: "custom",
      encode: { x: [0, 1, 2], y: 3 },
      data: [[0.1, 0.7, 0.4, 0]],
    });
  });

  it("projects conditional indirect effects and simple slopes with their own CIs", () => {
    const specs = buildResearchChartSpecs(
      run(
        {
          type: "moderatedMediation",
          x: "construct:x",
          m: "construct:m",
          y: "construct:y",
          w: "construct:w",
          covariates: [],
          bootstrap: { resamples: 1000, seed: 7 },
        },
        [
          table(
            "conditional_indirect",
            ["effect", "estimate", "ciLow", "ciHigh"],
            [
              { effect: "W=-1", estimate: 0.2, ciLow: null, ciHigh: null },
              { effect: "W=0", estimate: 0.3, ciLow: -0.1, ciHigh: 0.5 },
            ],
          ),
          table(
            "simple_slopes",
            ["moderatorLevel", "estimate", "ciLow", "ciHigh"],
            [{ moderatorLevel: -1, estimate: 0.3, ciLow: 0.1, ciHigh: 0.5 }],
          ),
        ],
      ),
      {
        labels: {
          conditionalEffects: [
            "Low W indirect effect",
            "Mean W indirect effect",
          ],
        },
      },
    );
    expect(specs.map((spec) => spec.id)).toEqual([
      "conditional-indirect",
      "simple-slopes",
    ]);
    expect(specs[0]?.option.yAxis).toMatchObject({
      data: ["Mean W indirect effect"],
    });
    expect(specs[1]?.option.yAxis).toMatchObject({ data: ["W = -1 SD"] });
  });

  it("degrades to no chart when required tables or finite values are absent", () => {
    expect(
      buildResearchChartSpecs(
        run({ type: "reliability", constructIds: ["c1"] }, []),
      ),
    ).toEqual([]);
    expect(
      buildResearchChartSpecs(
        run(
          { type: "ols", outcome: "construct:y", predictors: ["construct:x"] },
          [
            table(
              "coefficients",
              ["term", "estimate", "ciLow", "ciHigh"],
              [
                {
                  term: "construct:x",
                  estimate: 0.4,
                  ciLow: null,
                  ciHigh: 0.7,
                },
              ],
            ),
          ],
        ),
      ),
    ).toEqual([]);
  });

  it("uses only canvas-safe static colors", () => {
    const specs = buildResearchChartSpecs(
      run({ type: "reliability", constructIds: ["c1"] }, [
        table(
          "reliability",
          ["construct", "rawAlpha"],
          [{ construct: "Satisfaction", rawAlpha: 0.82 }],
        ),
      ]),
    );
    expect(JSON.stringify(specs)).not.toContain("oklch");
    expect(JSON.stringify(specs)).toContain("#D97745");
  });
});
