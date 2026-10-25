// 研究面板用例（扩展缝的宿主侧实现）：mock transport 按 path/method 路由，
// 只验 UI 编排——自动映射、导入确认、一键计划三 run、报告链接、无结构化模型
// 兜底、synthetic 徽标、错误态；真实统计由 research 引擎自己的测试负责。
import { defineComponent, h, type Component } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import type {
  ResearchDatasetDetail,
  ResearchDatasetSummary,
  ResearchRunDetail,
  ResearchRunSummary,
  SurveyCodebook,
  SurveyDefinition,
} from "../../contracts/index.js";
import type { SurveysResearchContext } from "../research-host.js";
import SurveyResearchPanel from "./SurveyResearchPanel.vue";
import { createTestHost, mountSurveysComponent } from "../test-mount.js";

const surveyId = "00000000-0000-4000-8000-000000000001",
  revisionId = "00000000-0000-4000-8000-000000000002",
  datasetId = "00000000-0000-4000-8000-000000000003",
  syntheticDatasetId = "00000000-0000-4000-8000-000000000004",
  runId = "00000000-0000-4000-8000-000000000005";
const hash = (seed: string) => seed.padEnd(64, "0").slice(0, 64);

const constructs = [
  { id: "c1", label: "满意度", definition: "满意程度", questionIds: ["q1"] },
  { id: "c2", label: "购买意愿", definition: "购买倾向", questionIds: ["q2"] },
];
const variables = [
  {
    id: "q1.r1",
    label: "满意度条目一",
    kind: "ordinal",
    options: [{ id: "1", label: "1" }],
  },
  { id: "q1.r2", label: "满意度条目二", kind: "ordinal" },
  { id: "q2", label: "购买意愿", kind: "number" },
  { id: "q3", label: "年龄", kind: "number" },
];
const mmModel = {
  id: "am1",
  kind: "moderatedMediation",
  x: "construct:c1",
  m: "variable:q2",
  y: "construct:c2",
  w: "variable:q3",
  covariates: [],
  bootstrap: { resamples: 1000, seed: 20260902 },
} as const;
function makeDefinition(analysisModels: unknown[]): SurveyDefinition {
  return {
    version: 1,
    title: "Survey",
    description: "",
    consent: "",
    questions: [],
    pages: [],
    researchDesign: {
      researchQuestion: "r",
      population: "p",
      recruitment: "rec",
      purpose: "measure",
      timeBudgetMinutes: 5,
      constructs,
      analysisPlan: "plan",
      assumptions: [],
      pendingDecisions: [],
      ...(analysisModels ? { analysisModels } : {}),
    } as SurveyDefinition["researchDesign"],
  };
}
const codebookWithModels: SurveyCodebook = {
  surveyId,
  revisionId,
  revision: 1,
  definition: makeDefinition([mmModel]),
  variables,
};
const codebookWithoutModels: SurveyCodebook = {
  ...codebookWithModels,
  definition: makeDefinition([]),
};
const publicDataset: ResearchDatasetSummary = {
  id: datasetId,
  surveyId,
  revisionId,
  name: "公开样本",
  duplicateRowCount: 0,
  source: {
    kind: "public",
    title: "Open Sample",
    citation: "Doe (2026) Open Sample",
    url: "https://example.com/data.csv",
    license: "CC-BY-4.0",
    note: "公开复刻数据",
  },
  sourceSha256: hash("a1"),
  parserVersion: "research-csv-v1",
  rowCount: 200,
  mapping: [{ variableId: "q1.r1", column: "q1.r1" }],
  inputHash: hash("b2"),
  createdAt: "2026-01-01T00:00:00Z",
};
const syntheticDataset: ResearchDatasetSummary = {
  ...publicDataset,
  id: syntheticDatasetId,
  name: "合成演示",
  source: { kind: "synthetic", title: "合成演示", note: "随机生成" },
  rowCount: 50,
  createdAt: "2026-01-02T00:00:00Z",
};
const datasetDetail: ResearchDatasetDetail = {
  ...publicDataset,
  rowsHash: hash("c3"),
  columns: ["q1.r1", "q1.r2", "q2", "q3"],
  normalizedRowHashes: [hash("r1"), hash("r1"), hash("r2")],
  missingByVariable: { "q1.r1": 3 },
  duplicateRowCount: 1,
};
const mmRecipe = {
  type: "moderatedMediation" as const,
  x: "construct:c1",
  m: "variable:q2",
  y: "construct:c2",
  w: "variable:q3",
  covariates: [],
  bootstrap: { resamples: 1000, seed: 20260902 },
};
const runSummary: ResearchRunSummary = {
  id: runId,
  surveyId,
  revisionId,
  datasetId,
  sourceKind: "public",
  sourceSha256: hash("a1"),
  recipe: mmRecipe,
  engineVersion: "research-engine-v1",
  inputHash: hash("d4"),
  resultHash: hash("e5"),
  createdAt: "2026-01-03T00:00:00Z",
};
const runDetail: ResearchRunDetail = {
  ...runSummary,
  result: {
    method: "test",
    effectiveN: 188,
    missingRows: 12,
    tables: [
      {
        id: "conditional_indirect",
        title: "Bootstrap 条件间接效应",
        columns: [
          { key: "effect", label: "效应" },
          { key: "estimate", label: "估计" },
          { key: "ciLow", label: "CI 下限" },
        ],
        rows: [{ effect: "W=-1 条件间接效应", estimate: 0.12345, ciLow: null }],
      },
      {
        id: "model_fit",
        title: "模型诊断",
        columns: [
          { key: "statistic", label: "指标" },
          { key: "value", label: "值" },
        ],
        rows: [{ statistic: "Bootstrap seed", value: 20260902 }],
      },
    ],
    warnings: ["区间不等于因果。"],
    limitations: ["横断面数据不支持因果结论。"],
    chart: null,
  },
};

const context: SurveysResearchContext = {
  surveyId,
  revisionId,
  canWrite: true,
  exclusions: [],
};

function createRouter(
  options: {
    codebook?: SurveyCodebook;
    datasets?: ResearchDatasetSummary[];
    runs?: ResearchRunSummary[];
    failLoad?: boolean;
  } = {},
) {
  const createdRuns: Array<{ datasetId: string; recipe: { type: string } }> =
    [];
  const createdDatasets: Array<Record<string, unknown>> = [];
  let runSeq = 0;
  const router = vi.fn(
    async (path: string, init?: { method?: string; body?: unknown }) => {
      const method = init?.method ?? "GET";
      if (options.failLoad && path.includes("/codebook") && method === "GET")
        throw new Error("boom");
      if (path === `/api/surveys/${surveyId}/codebook?revisionId=${revisionId}`)
        return options.codebook ?? codebookWithModels;
      if (path === "/api/research/datasets" && method === "POST") {
        createdDatasets.push(init!.body as Record<string, unknown>);
        return { ...publicDataset, id: datasetId, name: "导入样本" };
      }
      if (path === `/api/research/surveys/${surveyId}/datasets`) {
        if (method === "GET")
          return {
            items: options.datasets ?? [publicDataset, syntheticDataset],
          };
      }
      if (path === `/api/research/surveys/${surveyId}/datasets/${datasetId}`)
        return datasetDetail;
      if (
        path ===
        `/api/research/surveys/${surveyId}/datasets/${syntheticDatasetId}`
      )
        return { ...datasetDetail, id: syntheticDatasetId };
      if (path === `/api/research/surveys/${surveyId}/runs`) {
        if (method === "GET") return { items: options.runs ?? [runSummary] };
        if (method === "POST") {
          const input = init!.body as {
            datasetId: string;
            recipe: { type: string };
          };
          createdRuns.push(input);
          runSeq += 1;
          const id = `00000000-0000-4000-8000-0000000001${String(runSeq).padStart(2, "0")}`;
          return { ...runSummary, id, recipe: input.recipe };
        }
      }
      if (path.startsWith(`/api/research/surveys/${surveyId}/runs/`)) {
        const id = path.slice(`/api/research/surveys/${surveyId}/runs/`.length);
        return { ...runDetail, id };
      }
      throw new Error(`transport 未在用例中提供: ${method} ${path}`);
    },
  );
  return { router, createdRuns, createdDatasets };
}

function render(
  contextOverrides: Partial<SurveysResearchContext> = {},
  routerOptions: Parameters<typeof createRouter>[0] = {},
  stubs: Record<string, Component> = {},
) {
  const { router, createdRuns, createdDatasets } = createRouter(routerOptions);
  const notify = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const host = createTestHost({
    transport: { request: router as never },
    notify,
  });
  const wrapper = mountSurveysComponent(
    SurveyResearchPanel,
    {
      props: { context: { ...context, ...contextOverrides } },
      global: { stubs },
    },
    host,
  );
  return { wrapper, createdRuns, createdDatasets, notify, router };
}

const DialogStub = defineComponent({
  name: "DialogStub",
  setup(_, { slots }) {
    return () =>
      h("div", { class: "dialog-stub" }, [slots.default?.(), slots.footer?.()]);
  },
});

async function openImportDialog(
  wrapper: Awaited<ReturnType<typeof render>>["wrapper"],
) {
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "导入数据集")!
    .trigger("click");
  await flushPromises();
}

async function chooseCsvFile(
  wrapper: Awaited<ReturnType<typeof render>>["wrapper"],
) {
  const csv = ["q1.r1,q1.r2,q2,q3", "4,5,3,21", "2,1,5,34", "5,5,2,28"].join(
    "\n",
  );
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    value: [new File([csv], "sample.csv", { type: "text/csv" })],
  });
  await input.trigger("change");
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("shows publish guidance before the first revision exists", async () => {
  const { wrapper } = render({ revisionId: "" });
  await flushPromises();
  expect(wrapper.text()).toContain("问卷尚未发布，还没有可分析的数据");
  expect(wrapper.text()).toContain("在「设计」页完成题目并发布第一版后");
  wrapper.unmount();
});

it("shows the error state with retry when loading fails", async () => {
  const { wrapper } = render({}, { failLoad: true });
  await flushPromises();
  expect(wrapper.text()).toContain("研究数据加载失败，请重试");
  const retry = wrapper
    .findAll("button")
    .find((button) => button.text().includes("重试"));
  expect(retry).toBeTruthy();
  wrapper.unmount();
});

it("lists datasets with source badges, hashes and picks the first as active", async () => {
  const { wrapper, router } = render();
  await flushPromises();
  expect(wrapper.text()).toContain("公开样本");
  expect(wrapper.text()).toContain("公开数据");
  expect(wrapper.text()).toContain("Doe (2026) Open Sample");
  expect(wrapper.text()).toContain("200 行");
  expect(wrapper.text()).toContain("a100000000");
  // synthetic 徽标与醒目提示。
  expect(wrapper.text()).toContain("合成数据");
  expect(wrapper.text()).toContain("合成数据，非真实受试者证据");
  // 默认选中第一个数据集并拉取详情（列清单用于构念可用性）。
  expect(wrapper.text()).toContain("当前数据集");
  expect(wrapper.text()).toContain("疑似重复行 1 行");
  expect(
    router.mock.calls.filter(
      ([path]) =>
        String(path) ===
        `/api/research/surveys/${surveyId}/datasets/${datasetId}`,
    ),
  ).toHaveLength(1);
  wrapper.unmount();
});

it("renders the fixed run result with the report link and formatted numbers", async () => {
  const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
  const { wrapper } = render();
  await flushPromises();
  expect(wrapper.text()).toContain("调节中介分析（Bootstrap）");
  expect(wrapper.find(".result-metrics").text()).toContain("188");
  expect(wrapper.find(".result-metrics").text()).toContain("12");
  expect(wrapper.text()).toContain("区间不等于因果。");
  expect(wrapper.text()).toContain("0.1235");
  expect(wrapper.text()).toContain("不可计算");
  expect(wrapper.text()).toContain("Bootstrap 条件间接效应");
  expect(wrapper.text()).toContain("20260902");
  expect(wrapper.text()).not.toContain("20260000");
  const report = wrapper
    .findAll("button")
    .find((button) => button.text() === "查看完整报告")!;
  expect(report.exists()).toBe(true);
  await report.trigger("click");
  expect(openSpy).toHaveBeenCalledWith(
    `/api/research/surveys/${surveyId}/runs/${runId}/report.html`,
    "_blank",
    "noopener",
  );
  openSpy.mockRestore();
  wrapper.unmount();
});

it("creates reliability, EFA and moderatedMediation runs from one click", async () => {
  const { wrapper, createdRuns, notify } = render();
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "一键运行研究计划")!
    .trigger("click");
  await flushPromises();
  expect(createdRuns.map((run) => run.recipe.type)).toEqual([
    "reliability",
    "efa",
    "moderatedMediation",
  ]);
  expect(createdRuns.every((run) => run.datasetId === datasetId)).toBe(true);
  const efa = createdRuns[1]!.recipe as { type: string; factorCount?: number };
  expect(efa.factorCount).toBe(2);
  expect(notify.success).toHaveBeenCalledWith("研究计划已完成，结果已生成。");
  wrapper.unmount();
});

it("falls back to manual role selection when no structured models exist", async () => {
  const { wrapper, createdRuns } = render(
    {},
    { codebook: codebookWithoutModels },
  );
  await flushPromises();
  // 无结构化模型：一键仍在（信度/EFA 可跑），但提示缺调节中介并给出角色选择。
  expect(wrapper.text()).toContain("当前计划未包含调节中介");
  expect(wrapper.text()).toContain("手动指定调节中介变量");
  // aria-label 由 PrimeVue 落到内部元素而非组件根，按模板顺序取角色下拉。
  const roleSelects = wrapper
    .find(".manual-plan .role-grid")
    .findAllComponents({ name: "Select" });
  expect(roleSelects).toHaveLength(4);
  const roles = ["construct:c1", "variable:q2", "construct:c2", "variable:q3"];
  for (const [index, value] of roles.entries()) {
    await roleSelects[index]!.vm.$emit("update:modelValue", value);
  }
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "运行调节中介分析")!
    .trigger("click");
  await flushPromises();
  expect(createdRuns).toHaveLength(1);
  expect(createdRuns[0]!.recipe).toMatchObject({
    type: "moderatedMediation",
    x: "construct:c1",
    m: "variable:q2",
    y: "construct:c2",
    w: "variable:q3",
    bootstrap: { resamples: 1000, seed: 20260902 },
  });
  wrapper.unmount();
});

describe("dataset import dialog", () => {
  async function fillSourceFields(
    wrapper: Awaited<ReturnType<typeof render>>["wrapper"],
  ) {
    // PrimeVue Select 内部也渲染 .p-inputtext，只取不在下拉里的字段输入框；
    // 顺序 = 数据集名称、标题、引用、链接、许可、说明（名称已有文件名缺省）。
    const fields = wrapper
      .findAll(
        ".dialog-stub input.p-inputtext, .dialog-stub textarea.p-textarea",
      )
      .filter(
        (input) => !(input.element as HTMLInputElement).closest(".p-select"),
      );
    expect(fields).toHaveLength(6);
    const values = [
      null,
      "Open Sample",
      "Doe (2026) Open Sample",
      "https://example.com/data.csv",
      "CC-BY-4.0",
      "公开复刻数据",
    ];
    for (const [index, value] of values.entries()) {
      if (value) await fields[index]!.setValue(value);
    }
    await flushPromises();
  }

  it("auto-maps codebook variables to columns and submits the confirmed source", async () => {
    const { wrapper, createdDatasets, notify } = render(
      {},
      {},
      { Dialog: DialogStub },
    );
    await flushPromises();
    await openImportDialog(wrapper);
    expect(wrapper.find(".dialog-stub").exists()).toBe(true);
    await chooseCsvFile(wrapper);
    expect(wrapper.text()).toContain("已读取 4 列 × 3 行数据");
    // 4 个变量全部自动命中（exact / rowItem / label）。
    expect(wrapper.text()).toContain("已自动匹配 4 / 4 个变量");
    await fillSourceFields(wrapper);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "确认导入")!
      .trigger("click");
    await flushPromises();
    expect(createdDatasets).toHaveLength(1);
    expect(createdDatasets[0]).toMatchObject({
      surveyId,
      revisionId,
      name: "sample",
      mapping: [
        { variableId: "q1.r1", column: "q1.r1" },
        { variableId: "q1.r2", column: "q1.r2" },
        { variableId: "q2", column: "q2" },
        { variableId: "q3", column: "q3" },
      ],
      source: {
        kind: "public",
        citation: "Doe (2026) Open Sample",
        license: "CC-BY-4.0",
        note: "公开复刻数据",
        title: "Open Sample",
        url: "https://example.com/data.csv",
      },
    });
    expect(notify.success).toHaveBeenCalledWith("数据集「导入样本」已导入。");
    wrapper.unmount();
  });

  it("keeps import disabled until the public source fields are complete", async () => {
    const { wrapper } = render({}, {}, { Dialog: DialogStub });
    await flushPromises();
    await openImportDialog(wrapper);
    await chooseCsvFile(wrapper);
    // 来源字段默认为空：公开数据的必填校验挡住提交。
    const submit = () =>
      wrapper.findAll("button").find((button) => button.text() === "确认导入")!;
    expect(submit().attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain(
      "公开数据需要完整填写标题、引用、链接、许可与说明",
    );
    wrapper.unmount();
  });
});

it("prioritizes existing results and keeps data and plan collapsed", async () => {
  const { wrapper } = render();
  await flushPromises();
  expect(wrapper.find(".research-settings").attributes("open")).toBeUndefined();
  expect(
    wrapper
      .find(".research-flow")
      .element.firstElementChild?.classList.contains("results-block"),
  ).toBe(true);
  expect(wrapper.find(".run-history button").attributes("aria-pressed")).toBe(
    "true",
  );
  wrapper.unmount();
});

it("opens data and plan for first use and prevents runs in read-only mode", async () => {
  const { wrapper, createdRuns } = render({ canWrite: false }, { runs: [] });
  await flushPromises();
  expect(wrapper.find(".research-settings").attributes("open")).toBeDefined();
  expect(wrapper.find(".results-block").exists()).toBe(false);
  const run = wrapper
    .findAll("button")
    .find((button) => button.text() === "一键运行研究计划")!;
  expect(run.attributes("disabled")).toBeDefined();
  await run.trigger("click");
  expect(createdRuns).toHaveLength(0);
  wrapper.unmount();
});

it("keeps the newest selection when a previous run request resolves late", async () => {
  const secondId = "00000000-0000-4000-8000-000000000006";
  const { wrapper, router } = render(
    {},
    { runs: [runSummary, { ...runSummary, id: secondId }] },
  );
  await flushPromises();
  const original = router.getMockImplementation()!;
  let finishFirst!: (value: ResearchRunDetail) => void;
  router.mockImplementation(async (path, init) => {
    if (path.endsWith(`/runs/${runId}`))
      return new Promise<ResearchRunDetail>((resolve) => {
        finishFirst = resolve;
      });
    if (path.endsWith(`/runs/${secondId}`))
      return {
        ...runDetail,
        id: secondId,
        result: { ...runDetail.result, method: "latest-selection" },
      };
    return original(path, init);
  });
  const buttons = wrapper.findAll(".run-history button");
  await buttons[0]!.trigger("click");
  await buttons[1]!.trigger("click");
  await flushPromises();
  finishFirst(runDetail);
  await flushPromises();
  expect(wrapper.find(".method-detail").text()).toContain("latest-selection");
  expect(buttons[1]!.attributes("aria-pressed")).toBe("true");
  wrapper.unmount();
});
