// 研究数据面服务与路由验收（#224 后端收口）：分类题导入/建模、点号反题、
// 重复记录披露、导入与运行幂等、权限闸、modelId 驱动运行、报告导出与路由级
// 400。存储为内存双 port 桩，不落 PG、不发网络。
import { describe, expect, it, vi } from "vitest";

import { validateSurveyDesign } from "../core/index.js";
import type { SurveyDefinition } from "../core/index.js";
import { makeDefinition } from "../core/test-fixtures.js";
import type { ResearchDatasetImportInput, SurveyResearchRecipe } from "../contracts/index.js";
import {
  renderResearchReportHtml,
  renderResearchResultCsv,
  researchRunJson,
} from "../research/report.js";
import type {
  ResearchDatasetRecord,
  ResearchRunRecord,
} from "../research/types.js";
import type { SurveysActor, SurveyRecord } from "../ports.js";
import { createResearchRoutes } from "./research-routes.js";
import { createResearchService } from "./research-service.js";

const SURVEY_ID = "00000000-0000-4000-8000-0000000000a1";
const REVISION_ID = "00000000-0000-4000-8000-0000000000a2";
const OWNER: SurveysActor = { userId: "owner", space: { kind: "personal" } };

const MODEL_HEADER = "gender,x1,x2,m1,m2,y1,y2,w1,w2";
const MODEL_MAPPING = MODEL_HEADER.split(",").map((column) => ({
  variableId: column,
  column,
}));

// 确定性伪随机样本（MINSTD）：40 行各异 + 第 1 行完整重复两次 →
// duplicateRowCount = 2。样本量够大，bootstrap 重采样不会撞奇异矩阵。
function modelRows(count: number): string[][] {
  let seed = 20260902;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: count }, () => [
    String(1 + Math.floor(next() * 2)),
    ...Array.from({ length: 8 }, () => String(1 + Math.floor(next() * 5))),
  ]);
}

const MODEL_ROWS: string[][] = (() => {
  const base = modelRows(40);
  return [...base, base[0]!, base[0]!];
})();

function csvOf(rows: string[][], header = MODEL_HEADER): string {
  return [header, ...rows.map((row) => row.join(","))].join("\n");
}

function importInput(csv: string, name = "研究数据集"): ResearchDatasetImportInput {
  return {
    surveyId: SURVEY_ID,
    revisionId: REVISION_ID,
    name,
    csv,
    mapping: MODEL_MAPPING,
    source: { kind: "synthetic", title: "合成数据", note: "服务验收fixture" },
  };
}

const scale = (id: string) => ({
  id,
  type: "scale" as const,
  title: id,
  required: true,
  min: 1,
  max: 5,
});

const modelDefinition: SurveyDefinition = {
  version: 1,
  title: "研究问卷",
  description: "",
  consent: "",
  questions: [
    {
      id: "gender",
      type: "single",
      title: "性别",
      required: true,
      options: [
        { id: "1", label: "男" },
        { id: "2", label: "女" },
      ],
    },
    scale("x1"), scale("x2"), scale("m1"), scale("m2"),
    scale("y1"), scale("y2"), scale("w1"), scale("w2"),
  ],
  pages: [{
    id: "p1",
    title: "页",
    questionIds: ["gender", "x1", "x2", "m1", "m2", "y1", "y2", "w1", "w2"],
  }],
  researchDesign: {
    researchQuestion: "X 经 M 影响 Y 的过程是否受 W 调节",
    population: "大学生",
    recruitment: "海报",
    purpose: "measure",
    timeBudgetMinutes: 10,
    constructs: [
      { id: "x", label: "X 维度", definition: "自变量", questionIds: ["x1", "x2"] },
      { id: "m", label: "M 维度", definition: "中介变量", questionIds: ["m1", "m2"] },
      { id: "y", label: "Y 维度", definition: "结果变量", questionIds: ["y1", "y2"] },
      { id: "w", label: "W 维度", definition: "调节变量", questionIds: ["w1", "w2"] },
    ],
    analysisPlan: "有调节的中介分析",
    analysisModels: [{
      id: "mm-1",
      kind: "moderatedMediation",
      x: "construct:x",
      m: "construct:m",
      y: "construct:y",
      w: "construct:w",
      covariates: ["variable:gender"],
      bootstrap: { resamples: 100, seed: 20260902 },
      efa: { constructId: "m", factorCount: 1 },
    }],
    assumptions: [],
    pendingDecisions: [],
  },
};

// 矩阵题变量 id 带点号（mx.r1）；反向题登记必须按变量身份写。
const reverseDefinition: SurveyDefinition = {
  version: 1,
  title: "反向题问卷",
  description: "",
  consent: "",
  questions: [{
    id: "mx",
    type: "matrix_single",
    title: "矩阵量表",
    required: true,
    rows: [
      { id: "r1", label: "条目一" },
      { id: "r2", label: "条目二" },
      { id: "r3", label: "条目三" },
    ],
    columns: [
      { id: "c1", label: "1" }, { id: "c2", label: "2" }, { id: "c3", label: "3" },
      { id: "c4", label: "4" }, { id: "c5", label: "5" },
    ],
  }],
  pages: [{ id: "p1", title: "页", questionIds: ["mx"] }],
  researchDesign: {
    researchQuestion: "构念信度",
    population: "大学生",
    recruitment: "海报",
    purpose: "measure",
    timeBudgetMinutes: 5,
    constructs: [{
      id: "rev",
      label: "反向维度",
      definition: "含一个反向计分条目",
      questionIds: ["mx"],
      scoring: { method: "mean", reverseVariableIds: ["mx.r2"], minValid: 1 },
    }],
    analysisPlan: "信度分析",
    assumptions: [],
    pendingDecisions: [],
  },
};

function memoryPorts(definition: SurveyDefinition) {
  const surveys = new Map<string, SurveyRecord>([[SURVEY_ID, {
    id: SURVEY_ID,
    userId: OWNER.userId,
    teamId: null,
    title: "研究问卷",
    slug: "slug-00000000000000a1",
    status: "published",
    currentRevisionId: REVISION_ID,
    draftVersion: 1,
    draftJson: definition,
    completedCount: 0,
    responseLimit: 1000,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  }]]);
  const revisions = new Map([[REVISION_ID, {
    id: REVISION_ID,
    surveyId: SURVEY_ID,
    revision: 1,
    definitionJson: definition,
    contentHash: "content-hash",
    createdAt: new Date(0),
  }]]);
  const datasets: ResearchDatasetRecord[] = [];
  const runs: ResearchRunRecord[] = [];
  const resolveResourceAccess = vi.fn(async () => ({
    canRead: true,
    canWrite: true,
    canDelete: true,
  }));
  const unimplemented = () => {
    throw new Error("unimplemented_port");
  };
  const storage = {
    findById: async (id: string, opts?: { excludeDeleted?: boolean }) => {
      const row = surveys.get(id);
      if (!row) return null;
      if (opts?.excludeDeleted && row.deletedAt) return null;
      return row;
    },
    findBySlug: async () => null,
    listByOwner: async () => [...surveys.values()],
    create: async () => ({ id: SURVEY_ID }),
    countStarted: async () => 0,
    countFinished: async () => 0,
    listRevisions: async () => [],
    findRevisionOfSurvey: async (_surveyId: string, revisionId: string) =>
      revisions.get(revisionId) ?? null,
    listFinishedResponses: async () => [],
    findMediaBinding: unimplemented,
    createMediaBinding: unimplemented,
    findPublishedAssetSha: unimplemented,
    withSurveyLock: unimplemented,
    findResearchDatasetByInput: async (surveyId: string, revisionId: string, inputHash: string) =>
      datasets.find(
        (row) => row.surveyId === surveyId && row.revisionId === revisionId && row.inputHash === inputHash,
      ) ?? null,
    findResearchDataset: async (surveyId: string, datasetId: string) =>
      datasets.find((row) => row.surveyId === surveyId && row.id === datasetId) ?? null,
    listResearchDatasets: async (surveyId: string) =>
      datasets.filter((row) => row.surveyId === surveyId),
    insertResearchDataset: async (record: ResearchDatasetRecord) => {
      datasets.push(record);
      return record;
    },
    findResearchRunByInput: async (surveyId: string, inputHash: string) =>
      runs.find((row) => row.surveyId === surveyId && row.inputHash === inputHash) ?? null,
    findResearchRun: async (surveyId: string, runId: string) =>
      runs.find((row) => row.surveyId === surveyId && row.id === runId) ?? null,
    listResearchRuns: async (surveyId: string) => runs.filter((row) => row.surveyId === surveyId),
    insertResearchRun: async (record: ResearchRunRecord) => {
      runs.push(record);
      return record;
    },
  };
  const ports = {
    auth: { resolveResourceAccess, resolveSpaceAccess: async () => ({ canRead: true, canWrite: true }) },
    storage,
  } as unknown as Parameters<typeof createResearchService>[0];
  return { service: createResearchService(ports), datasets, runs, resolveResourceAccess };
}

describe("分类题导入与解码", () => {
  it("选项 id 与 label 均可解码，域外数值按 codebook 拒绝", async () => {
    const { service, datasets } = memoryPorts(modelDefinition);
    const labeled = MODEL_ROWS.map(([gender, ...rest]) => [
      gender === "1" ? "男" : "女",
      ...rest,
    ]);
    const byLabel = await service.importDataset(OWNER.userId, importInput(csvOf(labeled), "label 解码"));
    expect(byLabel.rowCount).toBe(42);
    expect(datasets[0]!.normalizedRows[0]!.gender).toBe(Number(MODEL_ROWS[0]![0]));
    expect(datasets[0]!.normalizedRows[1]!.gender).toBe(Number(MODEL_ROWS[1]![0]));

    const byId = await service.importDataset(OWNER.userId, importInput(csvOf(MODEL_ROWS), "id 解码"));
    expect(byId.id).not.toBe(byLabel.id);
    expect(datasets[1]!.normalizedRows[0]!.gender).toBe(Number(MODEL_ROWS[0]![0]));

    const bad = MODEL_ROWS.map((row, index) => (index === 0 ? ["3", ...row.slice(1)] : row));
    await expect(
      service.importDataset(OWNER.userId, importInput(csvOf(bad), "域外值")),
    ).rejects.toMatchObject({ code: "invalid_csv_value", status: 400 });
  });

  it("点号反题 id 可登记并真正反向计分", async () => {
    expect(validateSurveyDesign(reverseDefinition)).toEqual([]);
    const { service } = memoryPorts(reverseDefinition);
    const csv = csvOf(
      [["1", "5", "1"], ["2", "4", "2"], ["3", "3", "3"], ["4", "2", "4"]],
      "mx.r1,mx.r2,mx.r3",
    );
    const detail = await service.importDataset(OWNER.userId, {
      surveyId: SURVEY_ID,
      revisionId: REVISION_ID,
      name: "反题数据集",
      csv,
      mapping: [
        { variableId: "mx.r1", column: "mx.r1" },
        { variableId: "mx.r2", column: "mx.r2" },
        { variableId: "mx.r3", column: "mx.r3" },
      ],
      source: { kind: "synthetic", title: "合成数据", note: "反题fixture" },
    });
    const run = await service.createRun(OWNER.userId, SURVEY_ID, {
      datasetId: detail.id,
      recipe: { type: "reliability", constructIds: ["rev"] },
    });
    const reliability = run.result.tables.find((table) => table.id === "reliability")!;
    // r2 反向后三列完全相同（1,2,3,4）， identical items 的 raw alpha 恒为 1。
    expect(Number(reliability.rows[0]!.rawAlpha)).toBeCloseTo(1, 10);
    const mappingTable = run.result.tables.find((table) => table.id === "variable_mapping")!;
    expect(mappingTable.rows.find((row) => row.variable === "mx.r2")!.reverse).toBe("是");
  });
});

describe("重复记录披露", () => {
  it("detail 计数、行不删除，报告三态导出都带警告", async () => {
    const { service } = memoryPorts(modelDefinition);
    const detail = await service.importDataset(OWNER.userId, importInput(csvOf(MODEL_ROWS)));
    expect(detail.rowCount).toBe(42);
    expect(detail.duplicateRowCount).toBe(2);
    expect(detail.normalizedRowHashes).toHaveLength(42);

    const run = await service.createRun(OWNER.userId, SURVEY_ID, {
      datasetId: detail.id,
      recipe: { type: "reliability", constructIds: ["x", "m", "y", "w"] },
    });
    const exported = await service.getRunExport(OWNER.userId, SURVEY_ID, run.id);
    const json = researchRunJson(exported);
    expect(json.dataset.duplicateRowCount).toBe(2);
    expect(json.warnings).toContain("存在完全重复记录，本运行未删除（共 2 条）。");

    const html = renderResearchReportHtml(exported);
    expect(html).toContain("存在完全重复记录，本运行未删除");
    expect(html).toContain("其中完全重复记录");

    const csv = renderResearchResultCsv(exported);
    expect(csv).toContain("row_count,42");
    expect(csv).toContain("duplicate_row_count,2");
  });
});

describe("导入与运行幂等", () => {
  it("同输入重复导入/运行返回同一记录，不新增行", async () => {
    const { service, runs } = memoryPorts(modelDefinition);
    const first = await service.importDataset(OWNER.userId, importInput(csvOf(MODEL_ROWS)));
    const second = await service.importDataset(OWNER.userId, importInput(csvOf(MODEL_ROWS)));
    expect(second.id).toBe(first.id);

    const recipe: Extract<SurveyResearchRecipe, { type: "reliability" }> = {
      type: "reliability",
      constructIds: ["x", "m"],
    };
    const runA = await service.createRun(OWNER.userId, SURVEY_ID, { datasetId: first.id, recipe });
    const runB = await service.createRun(OWNER.userId, SURVEY_ID, { datasetId: first.id, recipe });
    expect(runB.id).toBe(runA.id);
    expect(runs).toHaveLength(1);
  });
});

describe("权限闸", () => {
  it("非成员一律 404，只读成员写操作 403", async () => {
    const { service, resolveResourceAccess } = memoryPorts(modelDefinition);
    resolveResourceAccess.mockResolvedValue({ canRead: false, canWrite: false, canDelete: false });
    await expect(service.importDataset(OWNER.userId, importInput(csvOf(MODEL_ROWS))))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(service.listDatasets(OWNER.userId, SURVEY_ID))
      .rejects.toMatchObject({ code: "not_found", status: 404 });

    resolveResourceAccess.mockResolvedValue({ canRead: true, canWrite: false, canDelete: false });
    await expect(service.importDataset(OWNER.userId, importInput(csvOf(MODEL_ROWS))))
      .rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("数据集可读、建运行需写权限", async () => {
    const { service, resolveResourceAccess } = memoryPorts(modelDefinition);
    const detail = await service.importDataset(OWNER.userId, importInput(csvOf(MODEL_ROWS)));
    resolveResourceAccess.mockResolvedValue({ canRead: true, canWrite: false, canDelete: false });
    await expect(service.getDataset(OWNER.userId, SURVEY_ID, detail.id)).resolves.toMatchObject({
      id: detail.id,
    });
    await expect(
      service.createRun(OWNER.userId, SURVEY_ID, {
        datasetId: detail.id,
        recipe: { type: "reliability", constructIds: ["x"] },
      }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(service.getDataset(OWNER.userId, SURVEY_ID, "00000000-0002-4311-8111-222222222222"))
      .rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});

describe("modelId 驱动运行", () => {
  it("结构化模型展开为主分析 + 附带 EFA，协变量进结果方程", async () => {
    const { service } = memoryPorts(modelDefinition);
    const detail = await service.importDataset(OWNER.userId, importInput(csvOf(MODEL_ROWS)));
    const run = await service.createRun(OWNER.userId, SURVEY_ID, {
      datasetId: detail.id,
      modelId: "mm-1",
    });
    expect(run.recipe).toMatchObject({
      type: "moderatedMediation",
      x: "construct:x",
      m: "construct:m",
      y: "construct:y",
      w: "construct:w",
      covariates: ["variable:gender"],
    });
    const outcome = run.result.tables.find((table) => table.id === "outcome_model")!;
    expect(outcome.rows.map((row) => row.term)).toContain("gender");

    const list = await service.listRuns(OWNER.userId, SURVEY_ID);
    expect(list).toHaveLength(2);
    expect(list.find((item) => item.recipe.type === "efa")!.recipe).toEqual({
      type: "efa",
      constructIds: ["m"],
      factorCount: 1,
    });
    await expect(
      service.createRun(OWNER.userId, SURVEY_ID, { datasetId: detail.id, modelId: "mm-1" }),
    ).resolves.toMatchObject({ id: run.id });
    expect(await service.listRuns(OWNER.userId, SURVEY_ID)).toHaveLength(2);
  });

  it("未知模型 422", async () => {
    const { service } = memoryPorts(modelDefinition);
    const detail = await service.importDataset(OWNER.userId, importInput(csvOf(MODEL_ROWS)));
    await expect(
      service.createRun(OWNER.userId, SURVEY_ID, { datasetId: detail.id, modelId: "missing" }),
    ).rejects.toMatchObject({ code: "invalid_recipe", status: 422 });
  });
});

describe("旧定义兼容", () => {
  it("无 researchDesign 与无 analysisModels 的定义都合法", () => {
    expect(validateSurveyDesign(makeDefinition())).toEqual([]);
    expect(validateSurveyDesign(reverseDefinition)).toEqual([]);
    const { service } = memoryPorts(reverseDefinition);
    expect(service).toBeTruthy();
  });
});

describe("研究路由", () => {
  it("recipe 与 modelId 互斥：都给与都不给都 400", async () => {
    const { service } = memoryPorts(modelDefinition);
    const routes = createResearchRoutes({ service, actorOf: () => OWNER });
    const detail = await service.importDataset(OWNER.userId, importInput(csvOf(MODEL_ROWS)));
    const post = (body: unknown) =>
      routes.request(`/surveys/${SURVEY_ID}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const both = await post({
      datasetId: detail.id,
      recipe: { type: "reliability", constructIds: ["x"] },
      modelId: "mm-1",
    });
    expect(both.status).toBe(400);
    expect(await both.json()).toMatchObject({ error: "invalid_input" });
    expect((await post({ datasetId: detail.id })).status).toBe(400);
  });

  it("数据集列表 200，导出路由带重复披露", async () => {
    const { service } = memoryPorts(modelDefinition);
    const routes = createResearchRoutes({ service, actorOf: () => OWNER });
    const detail = await service.importDataset(OWNER.userId, importInput(csvOf(MODEL_ROWS)));
    const list = await routes.request(`/surveys/${SURVEY_ID}/datasets`);
    expect(list.status).toBe(200);
    expect((await list.json() as { items: Array<{ duplicateRowCount: number }> }).items[0]!.duplicateRowCount).toBe(2);

    const run = await service.createRun(OWNER.userId, SURVEY_ID, {
      datasetId: detail.id,
      recipe: { type: "reliability", constructIds: ["x"] },
    });
    const exported = await routes.request(`/surveys/${SURVEY_ID}/runs/${run.id}/result.json`);
    expect(exported.status).toBe(200);
    expect((await exported.json() as { warnings: string[] }).warnings).toContain(
      "存在完全重复记录，本运行未删除（共 2 条）。",
    );
  });
});
