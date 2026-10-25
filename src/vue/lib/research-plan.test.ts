import { describe, expect, it } from "vitest";

import type { SurveyResearchConstruct } from "../../core/index.js";
import {
  buildModeratedMediationRecipe,
  buildResearchPlan,
  parseAnalysisModels,
  planHasModeratedMediation,
  usableConstructIds,
} from "./research-plan.js";

describe("usableConstructIds", () => {
  const constructs: SurveyResearchConstruct[] = [
    { id: "c1", label: "满意度", definition: "", questionIds: ["q1"] },
    { id: "c2", label: "意愿", definition: "", questionIds: ["q2"] },
    { id: "c3", label: "文本", definition: "", questionIds: ["q3"] },
  ];

  it("keeps constructs with mapped numeric items, expanding matrix row ids", () => {
    const variables = [
      { id: "q1.r1", kind: "ordinal" },
      { id: "q1.r2", kind: "ordinal" },
      { id: "q2", kind: "number" },
      { id: "q3", kind: "text" },
    ];
    expect(
      usableConstructIds(constructs, variables, ["q1.r1", "q1.r2", "q2", "q3"]),
    ).toEqual(["c1", "c2"]);
  });

  it("drops constructs whose items are not mapped in the dataset", () => {
    expect(usableConstructIds(constructs, [{ id: "q1.r1", kind: "ordinal" }], [])).toEqual(
      [],
    );
  });
});

describe("parseAnalysisModels", () => {
  it("parses the official kind-based models and expands the attached EFA check", () => {
    const { recipes, ignored } = parseAnalysisModels([
      {
        id: "am1",
        kind: "moderatedMediation",
        x: "construct:c1",
        m: "variable:q2",
        y: "construct:c2",
        w: "variable:q3",
        covariates: [],
        bootstrap: { resamples: 1000, seed: 20260902 },
        efa: { constructId: "c1", factorCount: 2 },
      },
      { id: "am2", kind: "efa", constructId: "c2", factorCount: 3 },
    ]);
    expect(ignored).toBe(0);
    expect(recipes).toEqual([
      { type: "efa", constructIds: ["c1"], factorCount: 2 },
      {
        type: "moderatedMediation",
        x: "construct:c1",
        m: "variable:q2",
        y: "construct:c2",
        w: "variable:q3",
        covariates: [],
        bootstrap: { resamples: 1000, seed: 20260902 },
      },
      { type: "efa", constructIds: ["c2"], factorCount: 3 },
    ]);
  });

  it("parses supported legacy shapes and defaults bootstrap for moderated mediation", () => {
    const { recipes, ignored } = parseAnalysisModels([
      {
        type: "moderatedMediation",
        x: "construct:c1",
        m: "variable:q2",
        y: "construct:c2",
        w: "variable:q3",
      },
      { type: "ols", outcome: "construct:c2", predictors: ["construct:c1"] },
    ]);
    expect(ignored).toBe(0);
    expect(recipes).toEqual([
      {
        type: "moderatedMediation",
        x: "construct:c1",
        m: "variable:q2",
        y: "construct:c2",
        w: "variable:q3",
        covariates: [],
        bootstrap: { resamples: 1000, seed: 20260902 },
      },
      { type: "ols", outcome: "construct:c2", predictors: ["construct:c1"] },
    ]);
  });

  it("skips malformed entries without throwing", () => {
    const { recipes, ignored } = parseAnalysisModels([
      { type: "moderatedMediation", x: "oops" },
      { type: "efa", constructIds: ["construct:c1"], factorCount: 0 },
      { type: "reliability", constructIds: ["construct:c1"] },
      "garbage",
      null,
    ]);
    expect(recipes).toEqual([{ type: "reliability", constructIds: ["construct:c1"] }]);
    expect(ignored).toBe(4);
  });

  it("treats a non-array value as no models", () => {
    expect(parseAnalysisModels(null)).toEqual({ recipes: [], ignored: 0 });
    expect(parseAnalysisModels("planned")).toEqual({ recipes: [], ignored: 0 });
  });
});

describe("buildResearchPlan", () => {
  const mmModel = {
    type: "moderatedMediation",
    x: "construct:c1",
    m: "variable:q2",
    y: "construct:c2",
    w: "variable:q3",
    covariates: [],
  };

  it("orders reliability, EFA (factor count = construct count), then structured models", () => {
    const plan = buildResearchPlan({
      usableConstructIds: ["c1", "c2"],
      analysisModels: [mmModel],
    });
    expect(plan).toHaveLength(3);
    expect(plan[0]).toEqual({ type: "reliability", constructIds: ["c1", "c2"] });
    expect(plan[1]).toEqual({
      type: "efa",
      constructIds: ["c1", "c2"],
      factorCount: 2,
    });
    expect(plan[2]).toMatchObject({ type: "moderatedMediation" });
    expect(planHasModeratedMediation(plan)).toBe(true);
  });

  it("uses the designed EFA scope instead of deriving a conflicting one", () => {
    const plan = buildResearchPlan({
      usableConstructIds: ["c1", "c2"],
      analysisModels: [
        {
          id: "am1",
          kind: "moderatedMediation",
          x: "construct:c1",
          m: "variable:q2",
          y: "construct:c2",
          w: "variable:q3",
          covariates: [],
          efa: { constructId: "c1", factorCount: 4 },
        },
      ],
    });
    expect(plan.filter((recipe) => recipe.type === "efa")).toEqual([
      { type: "efa", constructIds: ["c1"], factorCount: 4 },
    ]);
  });

  it("deduplicates structured models that repeat the derived reliability run", () => {
    const plan = buildResearchPlan({
      usableConstructIds: ["c1"],
      analysisModels: [{ type: "reliability", constructIds: ["construct:c1"] }],
    });
    expect(plan).toEqual([
      { type: "reliability", constructIds: ["c1"] },
      { type: "efa", constructIds: ["c1"], factorCount: 1 },
    ]);
  });

  it("returns only structured models when no construct has mapped items", () => {
    const plan = buildResearchPlan({
      usableConstructIds: [],
      analysisModels: [mmModel],
    });
    expect(plan).toEqual([
      {
        type: "moderatedMediation",
        x: "construct:c1",
        m: "variable:q2",
        y: "construct:c2",
        w: "variable:q3",
        covariates: [],
        bootstrap: { resamples: 1000, seed: 20260902 },
      },
    ]);
    expect(planHasModeratedMediation(plan)).toBe(true);
  });

  it("is empty without constructs or models", () => {
    expect(
      buildResearchPlan({ usableConstructIds: [], analysisModels: null }),
    ).toEqual([]);
  });
});

describe("buildModeratedMediationRecipe", () => {
  it("carries the explicit bootstrap settings into the wire recipe", () => {
    expect(
      buildModeratedMediationRecipe({
        x: "construct:c1",
        m: "variable:q2",
        y: "construct:c2",
        w: "variable:q3",
        covariates: ["variable:q4"],
        resamples: 2000,
        seed: 42,
      }),
    ).toEqual({
      type: "moderatedMediation",
      x: "construct:c1",
      m: "variable:q2",
      y: "construct:c2",
      w: "variable:q3",
      covariates: ["variable:q4"],
      bootstrap: { resamples: 2000, seed: 42 },
    });
  });
});
