import { describe, expect, it } from "vitest";

import type { SurveyDefinition } from "../core/index.js";
import type { SurveyResearchRecipe } from "../contracts/index.js";

import { runResearchAnalysis } from "./engine.js";
import { renderResearchReportHtml } from "./report.js";
import type { ResearchDatasetRecord, ResearchRunRecord } from "./types.js";

const scale = (id: string) => ({
  id,
  type: "scale" as const,
  title: id,
  required: true,
  min: 1,
  max: 5,
});

const definition: SurveyDefinition = {
  version: 1,
  title: "报告验收问卷",
  description: "",
  consent: "",
  questions: [
    scale("x1"),
    scale("x2"),
    scale("m1"),
    scale("m2"),
    scale("y1"),
    scale("y2"),
    scale("w1"),
    scale("w2"),
  ],
  pages: [
    {
      id: "p1",
      title: "页",
      questionIds: ["x1", "x2", "m1", "m2", "y1", "y2", "w1", "w2"],
    },
  ],
  researchDesign: {
    researchQuestion: "固定运行报告验收",
    population: "测试样本",
    recruitment: "确定性生成",
    purpose: "measure",
    timeBudgetMinutes: 5,
    constructs: [
      {
        id: "x",
        label: "X 维度",
        definition: "自变量",
        questionIds: ["x1", "x2"],
      },
      {
        id: "m",
        label: "M 维度",
        definition: "中介变量",
        questionIds: ["m1", "m2"],
      },
      {
        id: "y",
        label: "Y 维度",
        definition: "结果变量",
        questionIds: ["y1", "y2"],
      },
      {
        id: "w",
        label: "W 维度",
        definition: "调节变量",
        questionIds: ["w1", "w2"],
      },
    ],
    analysisPlan: "报告验收",
    assumptions: [],
    pendingDecisions: [],
  },
};

function normalizedRows(count: number) {
  let seed = 20260902;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: count }, () =>
    Object.fromEntries(
      ["x1", "x2", "m1", "m2", "y1", "y2", "w1", "w2"].map((id) => [
        id,
        1 + Math.floor(next() * 5),
      ]),
    ),
  );
}

function dataset(
  source: ResearchDatasetRecord["source"] = {
    kind: "synthetic",
    title: "确定性合成数据",
    note: "只用于报告验收",
  },
): ResearchDatasetRecord {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    surveyId: "00000000-0000-4000-8000-000000000102",
    revisionId: "00000000-0000-4000-8000-000000000103",
    name: "固定运行研究报告",
    source,
    sourceSha256: "a".repeat(64),
    parserVersion: "research-csv-v1",
    rowCount: 42,
    duplicateRowCount: 0,
    mapping: [],
    columns: [],
    normalizedRows: normalizedRows(42),
    normalizedRowHashes: [],
    rowsHash: "b".repeat(64),
    inputHash: "c".repeat(64),
    createdAt: new Date("2026-10-25T00:00:00.000Z"),
  };
}

function run(
  recipe: SurveyResearchRecipe,
  data = dataset(),
): ResearchRunRecord {
  return {
    id: "00000000-0000-4000-8000-000000000104",
    surveyId: data.surveyId,
    revisionId: data.revisionId,
    datasetId: data.id,
    sourceKind: data.source.kind,
    sourceSha256: data.sourceSha256,
    recipe,
    engineVersion: "research-engine-v1",
    inputHash: "d".repeat(64),
    resultHash: "e".repeat(64),
    result: runResearchAnalysis({ definition, dataset: data, recipe }),
    createdAt: new Date("2026-10-25T01:02:03.000Z"),
  };
}

const recipes: Array<[string, SurveyResearchRecipe]> = [
  ["reliability", { type: "reliability", constructIds: ["x", "m", "y", "w"] }],
  [
    "OLS",
    {
      type: "ols",
      outcome: "construct:y",
      predictors: ["construct:x", "construct:m"],
    },
  ],
  ["EFA", { type: "efa", constructIds: ["m"], factorCount: 1 }],
  [
    "moderatedMediation",
    {
      type: "moderatedMediation",
      x: "construct:x",
      m: "construct:m",
      y: "construct:y",
      w: "construct:w",
      covariates: [],
      bootstrap: { resamples: 100, seed: 20260902 },
    },
  ],
];

describe("研究 HTML 报告", () => {
  it.each(recipes)(
    "%s 固定运行包含真实 SSR 彩色图与未改写的完整结果表",
    (_name, recipe) => {
      const researchRun = run(recipe);
      const html = renderResearchReportHtml({
        run: researchRun,
        dataset: dataset(),
      });

      expect(html).toContain('<svg width="960"');
      expect(html).toContain("<path");
      expect(html).toContain("MangoWrite");
      expect(html).toContain("复核附录");
      expect(html).toContain(researchRun.result.method);
      expect(html).toContain(researchRun.id);
      expect(html).toContain(researchRun.surveyId);
      expect(html).toContain(researchRun.revisionId);
      expect(html).toContain(researchRun.inputHash);
      expect(html).toContain(researchRun.resultHash);
      expect(html).toContain("2026-10-25T01:02:03.000Z");
      expect(html.match(/<tbody>/g)).toHaveLength(
        researchRun.result.tables.length,
      );
      expect(html).not.toMatch(/<script\b|<link\b|\s(?:src|href)=/i);
      expect(html).not.toContain("normalizedRows");
      for (const table of researchRun.result.tables) {
        expect(html).toContain(`data-table-id="${table.id}"`);
        for (const row of table.rows) {
          for (const column of table.columns) {
            const value = row[column.key];
            if (value !== null && value !== undefined)
              expect(html).toContain(String(value));
          }
        }
      }
      const expectedCharts: Record<string, Array<[string, string]>> = {
        reliability: [["reliability", "reliability-alpha"]],
        ols: [["coefficients", "ols-coefficients"]],
        efa: [
          ["efa_variance", "efa-variance"],
          ["efa_loadings", "efa-loadings"],
        ],
        moderatedMediation: [
          ["conditional_indirect", "conditional-indirect"],
          ["simple_slopes", "simple-slopes"],
        ],
      };
      for (const [tableId, chartId] of expectedCharts[recipe.type] ?? []) {
        const section = html
          .split(`data-table-id="${tableId}"`)[1]
          ?.split("</section>")[0];
        expect(section).toContain(`data-chart-id="${chartId}"`);
        expect(section).toContain("<svg");
        expect(section?.indexOf("<figure")).toBeLessThan(
          section?.indexOf("<table") ?? -1,
        );
      }
    },
  );

  it("公开来源保留引用、URL 与许可，并清楚说明解释边界", () => {
    const data = dataset({
      kind: "public",
      title: "公开研究数据",
      citation: "Example citation",
      url: "https://example.test/dataset",
      license: "CC BY 4.0",
      note: "按原始研究设计复核",
    });
    const html = renderResearchReportHtml({
      run: run(recipes[0]![1], data),
      dataset: data,
    });
    expect(html).toContain("公开外部数据");
    expect(html).toContain("Example citation");
    expect(html).toContain("https://example.test/dataset");
    expect(html).toContain("CC BY 4.0");
    expect(html).toContain("不构成量表认证、结构验证或因果证明");
  });

  it("来源、标题、表名和表值均转义，不能注入 HTML、SVG 或脚本", () => {
    const data = dataset({
      kind: "synthetic",
      title: '<img src=x onerror="alert(1)">',
      note: '</p><script>alert("source")</script>',
    });
    data.name = '<svg onload="alert(1)">数据集';
    const researchRun = run(recipes[0]![1], data);
    researchRun.result.tables[0]!.title =
      '</h2><script>alert("table")</script>';
    researchRun.result.tables[0]!.rows[0]!.construct =
      '</td><script>alert("cell")</script>';
    researchRun.result.tables.find(
      (table) => table.id === "reliability",
    )!.rows[0]!.construct = '</text><script>alert("chart")</script>';
    const html = renderResearchReportHtml({ run: researchRun, dataset: data });

    expect(html).not.toMatch(/<script\b|<img\b|<svg\s+onload/i);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;svg onload=&quot;alert(1)&quot;&gt;数据集");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("normalizedRows");
  });
});
