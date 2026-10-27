// 数据段组件用例（issue #223 拆分后口径）：答卷列表/逐题摘要/样本排除留包内，
// 研究分析只验扩展缝（面板注入 + 激活状态 + select-revision 回传）。transport
// 按 path/method 路由，同时充当「包内没有 research API 调用」的守卫。
import { defineComponent, h, type Component } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import type {
  SurveyDefinition,
  SurveyDetail,
  SurveyResponseView,
} from "../../contracts/index.js";
import type { SurveysWebHost } from "../host.js";
import SurveyDataAnalysis from "./SurveyDataAnalysis.vue";
import SurveyResponseSummary from "./SurveyResponseSummary.vue";
import type { SurveysResearchContext } from "../research-host.js";
import { SurveysResearchPanelKey } from "../research-host.js";
import { createTestHost, mountSurveysComponent } from "../test-mount.js";

const id = "00000000-0000-4000-8000-000000000001",
  revision = "00000000-0000-4000-8000-000000000002";
const codebookVariables = [
  {
    id: "score",
    label: "Score",
    kind: "ordinal",
    options: [
      { id: "0", label: "0" },
      { id: "1", label: "1" },
    ],
  },
  {
    id: "group",
    label: "Group",
    kind: "categorical",
    options: [{ id: "a", label: "A" }],
  },
  { id: "note", label: "Note", kind: "text" },
];
const definition: SurveyDefinition = {
  version: 1,
  title: "Survey",
  description: "",
  consent: "",
  questions: [
    { id: "score", type: "scale" as const, title: "Score", required: false, min: 0, max: 1 },
    {
      id: "group",
      type: "single" as const,
      title: "Group",
      required: false,
      options: [{ id: "a", label: "A" }],
    },
    { id: "note", type: "text" as const, title: "Note", required: false },
  ],
  pages: [{ id: "p1", title: "", questionIds: ["score", "group", "note"] }],
};
const response = (
  responseId: string,
  answers: Record<string, unknown>,
): SurveyResponseView => ({
  id: responseId,
  revisionId: revision,
  answers: answers as SurveyResponseView["answers"],
  startedAt: "2026-01-01T00:00:00Z",
  completedAt: "2026-01-01T00:01:00Z",
  durationMs: 60_000,
});
const survey: SurveyDetail = {
  id,
  userId: "owner",
  teamId: null,
  title: "Survey",
  slug: "survey-fixture-216",
  status: "published",
  currentRevisionId: revision,
  draftVersion: 1,
  completedCount: 0,
  startedCount: 0,
  responseLimit: 5000,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  definition,
  revisions: [
    {
      id: revision,
      revision: 1,
      createdAt: "2026-01-01T00:00:00Z",
      contentHash: "a".repeat(64),
    },
  ],
  canWrite: true,
  canDelete: true,
};
const mocks = vi.hoisted(() => ({ download: vi.fn() }));
function transportRouter(
  responses: SurveyResponseView[] = [
    response("one", { score: 0, group: "a", note: "first" }),
    response("two", { score: 1 }),
  ],
  variables = codebookVariables,
  publishedDefinition = definition,
) {
  return async (path: string, init?: { method?: string }) => {
    if (path === `/api/surveys/${id}/responses?revisionId=${revision}` && !init?.method)
      return { items: responses };
    if (path === `/api/surveys/${id}/codebook?revisionId=${revision}` && !init?.method)
      return { surveyId: id, revisionId: revision, revision: 1, definition: publishedDefinition, variables };
    throw new Error(`transport 未在用例中提供: ${init?.method ?? "GET"} ${path}`);
  };
}
function render(
  mode: "data" | "analysis" = "data",
  {
    responses = [
      response("one", { score: 0, group: "a", note: "first" }),
      response("two", { score: 1 }),
    ],
    variables,
    surveyDefinition = definition,
    publishedDefinition = surveyDefinition,
    transport,
    provide,
    stubs,
  }: {
    responses?: SurveyResponseView[];
    variables?: typeof codebookVariables;
    surveyDefinition?: typeof definition;
    publishedDefinition?: typeof definition;
    /** request 具体签名与 wire 泛型不一致，统一在 render 内收口断言。 */
    transport?: { request?: unknown; download?: unknown };
    provide?: Record<string, unknown>;
    stubs?: Record<string, Component>;
  } = {},
) {
  const host = createTestHost({
    transport: (transport ?? {
      request: transportRouter(responses, variables, publishedDefinition),
    }) as SurveysWebHost["transport"],
  });
  const wrapper = mountSurveysComponent(
    SurveyDataAnalysis,
    {
      props: { survey: { ...survey, definition: surveyDefinition }, mode },
      global: { provide, stubs },
    },
    host,
  );
  return { wrapper, host };
}
beforeEach(() => {
  vi.clearAllMocks();
});

it("searches the visible data without changing the source", async () => {
  const request = vi.fn(transportRouter());
  const { wrapper } = render("data", { transport: { request } });
  await flushPromises();
  // 数据段默认逐题摘要（信息密度高的总览）；答卷列表是记录级下钻，切过去再搜。
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "答卷列表")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.findAll("tbody tr")).toHaveLength(2);
  await wrapper
    .find('input[aria-label="搜索当前数据表"]')
    .setValue("未回答");
  await flushPromises();
  expect(wrapper.findAll("tbody tr")).toHaveLength(1);
  expect(wrapper.text()).not.toContain("搜索只改变表格显示");
  // 数据视图切换与搜索都不发新请求：responses/codebook 各只在装载时取一次。
  expect(
    request.mock.calls.filter(([path]) => String(path).includes("/responses")),
  ).toHaveLength(1);
  wrapper.unmount();
});

describe("per-question summary tab (issue #217)", () => {
  it("defaults to the summary view and renders the loaded revision scope", async () => {
    const { wrapper } = render("data");
    await flushPromises();
    // 默认摘要：0–1 有序变量按量表分布卡呈现（真实题型 scale，不 NPS 化）。
    expect(wrapper.findComponent(SurveyResponseSummary).exists()).toBe(true);
    expect(wrapper.findComponent({ name: "Select" }).props("modelValue")).toBe(revision);
    expect(wrapper.text()).toContain("Score");
    expect(wrapper.findAll("tbody tr")).toHaveLength(0);
    wrapper.unmount();
  });

  it("summary view switches back to the table without refetching", async () => {
    const request = vi.fn(transportRouter());
    const { wrapper } = render("data", { transport: { request } });
    await flushPromises();
    const calls = request.mock.calls.length;
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "答卷列表")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "逐题摘要")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.findComponent(SurveyResponseSummary).exists()).toBe(true);
    expect(request.mock.calls.length).toBe(calls);
    wrapper.unmount();
  });
});

describe("lifecycle badge sync (issue #217)", () => {
  it("emits the loaded response count with the selected revision after each load", async () => {
    const { wrapper } = render("data", {
      responses: [response("one", { score: 0 }), response("two", {})],
    });
    await flushPromises();
    expect(wrapper.emitted("responses-loaded")).toEqual([
      [{ revisionId: revision, count: 2 }],
    ]);
    // 刷新按钮同路径：再上报一次。
    await wrapper.find('button[aria-label="刷新数据"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("responses-loaded")!.at(-1)).toEqual([
      { revisionId: revision, count: 2 },
    ]);
    wrapper.unmount();
  });
});

describe("data toolbar placement (issue #217 M3)", () => {
  it("刷新/导出工具条固定在滚动区外：不是宽表容器的后代", async () => {
    const { wrapper } = render("data");
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "答卷列表")!
      .trigger("click");
    await flushPromises();
    // 宽表横滚收在 DataTable 自己的滚动容器里；工具条（刷新/导出原始数据/
    // 导出变量字典）在组件外，不随宽表滚出视区。
    const table = wrapper.find("table");
    expect(table.exists()).toBe(true);
    const buttons = [
      wrapper.find('button[aria-label="刷新数据"]'),
      wrapper.findAll("button").find((b) => b.text() === "导出")!,
    ];
    for (const button of buttons) {
      expect(button.exists()).toBe(true);
      expect(table.element.contains(button.element)).toBe(false);
      expect(button.element.closest("section.data-analysis")).toBeTruthy();
    }
    wrapper.unmount();
  });
});

describe("summary follows the published definition's question types (issue #217 M1)", () => {
  const npsOptions = Array.from({ length: 11 }, (_, i) => ({
    id: String(i),
    label: String(i),
  }));
  const typedVariables = [
    { id: "q1", label: "Satisfaction", kind: "ordinal" as const, options: npsOptions },
  ];

  it("scale 题型呈现分布 + 均值，不被 NPS 化；徽章用真实题型", async () => {
    const { wrapper } = render("data", {
      responses: [response("one", { q1: 9 })],
      variables: typedVariables,
      surveyDefinition: {
        ...definition,
        questions: [
          { id: "q1", type: "scale" as const, title: "Satisfaction", required: false, min: 0, max: 10 },
        ],
        pages: [{ id: "p1", title: "", questionIds: ["q1"] }],
      },
    });
    await flushPromises();
    const card = wrapper.findComponent(SurveyResponseSummary).find(".summary-card");
    expect(card.find(".summary-kind").text()).toBe("量表");
    expect(card.find(".nps-segments").exists()).toBe(false);
    expect(card.find(".summary-metric").text()).toBe("9均值");
    wrapper.unmount();
  });

  it("定义不可得（codebook 变量在定义里无对应题）时回落形状推断并出角标", async () => {
    const { wrapper } = render("data", {
      responses: [response("one", { q1: 9 })],
      variables: typedVariables,
      surveyDefinition: { ...definition, questions: [], pages: [] },
    });
    await flushPromises();
    const card = wrapper.findComponent(SurveyResponseSummary).find(".summary-card");
    expect(card.find(".nps-segments").exists()).toBe(true);
    expect(card.find(".summary-kind--inferred").text()).toBe("按变量形状推断");
    wrapper.unmount();
  });
});

it("excludes selected rows with a reason, then restores them in place", async () => {
  // Dialog 以内联 stub 渲染，避免 PrimeVue 弹层 teleport 到 body 后无法断言。
  const DialogStub = defineComponent({
    name: "DialogStub",
    setup(_, { slots }) {
      return () =>
        h("div", { class: "dialog-stub" }, [
          slots.default?.(),
          slots.footer?.(),
        ]);
    },
  });
  const { wrapper } = render("data", { stubs: { Dialog: DialogStub } });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "答卷列表")!
    .trigger("click");
  await flushPromises();
  const excludeButton = () =>
    wrapper
      .findAll("button")
      .find((b) => b.text().includes("排除所选"))!;
  expect(wrapper.findAll("button").find((b) => b.text().includes("排除所选"))).toBeUndefined();
  await wrapper
    .findAll("tbody tr")[0]!
    .find('input[type="checkbox"]')
    .setValue(true);
  await excludeButton().trigger("click");
  await wrapper.find("textarea").setValue("重复作答");
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "排除样本")!
    .trigger("click");
  await flushPromises();
  // 样本状态列就地标记；排除清单带理由、可就地恢复。
  expect(wrapper.find("tbody tr").text()).toContain("已排除");
  expect(wrapper.text()).toContain("重复作答");
  expect(wrapper.text()).toContain("排除 1 份");
  await wrapper
    .findAll('button[aria-label="恢复样本"]')[0]!
    .trigger("click");
  await flushPromises();
  expect(wrapper.find("tbody tr").text()).toContain("保留");
  expect(wrapper.text()).not.toContain("重复作答");
  wrapper.unmount();
});

it("analysis mode renders the injected host panel with the activation context", async () => {
  const contexts: SurveysResearchContext[] = [];
  const panel = defineComponent({
    name: "ResearchPanelStub",
    props: { context: { type: Object, required: true } },
    emits: ["select-revision"],
    setup(props, { emit }) {
      contexts.push(props.context as SurveysResearchContext);
      return () =>
        h("div", { class: "research-stub" }, [
          h("span", { class: "research-stub__state" }, props.context.revisionId),
          h(
            "button",
            {
              class: "panel-jump",
              onClick: () => emit("select-revision", props.context.revisionId),
            },
            "jump",
          ),
        ]);
    },
  });
  const { wrapper } = render("analysis", {
    provide: { [SurveysResearchPanelKey as symbol]: panel },
  });
  await flushPromises();
  // 分析模式：包内不出分析配置，只挂宿主面板；激活状态带 surveyId/revisionId/canWrite。
  expect(wrapper.find(".research-stub").exists()).toBe(true);
  expect(wrapper.findComponent(SurveyResponseSummary).exists()).toBe(false);
  expect(contexts.at(-1)).toMatchObject({
    surveyId: id,
    revisionId: revision,
    canWrite: true,
    exclusions: [],
  });
  // 深链定位回传：select-revision 切版本并重新加载。
  await wrapper.find("button.panel-jump").trigger("click");
  await flushPromises();
  expect(wrapper.find(".research-stub__state").text()).toBe(revision);
  wrapper.unmount();
});

it("analysis mode without an injected host panel renders no research mount point", async () => {
  const { wrapper } = render("analysis");
  await flushPromises();
  expect(wrapper.find(".research-stub").exists()).toBe(false);
  expect(wrapper.findComponent(SurveyResponseSummary).exists()).toBe(false);
  wrapper.unmount();
});

it("export goes through the host transport download with the revision id", async () => {
  const request = vi.fn(transportRouter());
  const { wrapper } = render("data", {
    transport: { request, download: mocks.download },
  });
  await flushPromises();
  const items = wrapper.findComponent({ name: "Menu" }).props("model") as Array<{ command: () => void }>;
  items[0]!.command();
  await flushPromises();
  expect(mocks.download).toHaveBeenCalledWith(
    `/api/surveys/${id}/export?revisionId=${revision}`,
    "survey.csv",
  );
  wrapper.unmount();
});

it("keeps published answers and question types when the draft deletes or retargets questions", async () => {
  const publishedDefinition: SurveyDefinition = {
    ...definition,
    questions: [
      { id: "score", type: "scale", title: "Score", required: false, min: 0, max: 10 },
      { id: "note", type: "text", title: "Note", required: false, showIf: { questionId: "score", op: "eq", value: 9 } },
    ],
    pages: [{ id: "p1", title: "", questionIds: ["score", "note"] }],
  };
  const { wrapper } = render("data", {
    responses: [response("one", { score: 9, note: "published answer" })],
    variables: [
      { id: "score", label: "Score", kind: "ordinal", options: Array.from({ length: 11 }, (_, n) => ({ id: String(n), label: String(n) })) },
      { id: "note", label: "Note", kind: "text" },
    ],
    publishedDefinition,
    surveyDefinition: {
      ...definition,
      questions: [{ id: "score", type: "nps", title: "Score", required: false }],
      pages: [{ id: "p1", title: "", questionIds: ["score"] }],
    },
  });
  await flushPromises();
  expect(wrapper.find(".summary-kind").text()).toBe("量表");
  expect(wrapper.find(".summary-metric").text()).toBe("9均值");
  expect(wrapper.text()).toContain("published answer");
  await wrapper.findAll("button").find((b) => b.text() === "答卷列表")!.trigger("click");
  await flushPromises();
  expect(wrapper.find("tbody tr").text()).toContain("published answer");
  wrapper.unmount();
});

it("projects an older selected revision independently of the current publication", async () => {
  const currentRevision = "00000000-0000-4000-8000-000000000003";
  const historicalDefinition: SurveyDefinition = {
    ...definition,
    questions: [{ id: "note", type: "text", title: "Historical note", required: false }],
    pages: [{ id: "p1", title: "Page", questionIds: ["note"] }],
  };
  const request = vi.fn(async (path: string) => {
    const selected = new URL(path, "https://test.invalid").searchParams.get("revisionId");
    const selectedDefinition = selected === revision ? historicalDefinition : definition;
    if (path.includes("/codebook")) return {
      surveyId: id, revisionId: selected, revision: selected === revision ? 1 : 2,
      definition: selectedDefinition,
      variables: selected === revision ? [{ id: "note", label: "Historical note", kind: "text" }] : codebookVariables,
    };
    return { items: selected === revision ? [response("old", { note: "old retained answer" })] : [] };
  });
  const host = createTestHost({ transport: { request: request as SurveysWebHost["transport"]["request"] } });
  const wrapper = mountSurveysComponent(SurveyDataAnalysis, {
    props: {
      survey: {
        ...survey, currentRevisionId: currentRevision,
        revisions: [...survey.revisions, { ...survey.revisions[0]!, id: currentRevision, revision: 2 }],
      },
      mode: "data",
    },
  }, host);
  await flushPromises();
  const select = wrapper.findComponent({ name: "Select" });
  select.vm.$emit("update:modelValue", revision);
  await flushPromises();
  expect(select.props("modelValue")).toBe(revision);
  expect(wrapper.emitted("revision-change")!.at(-1)).toEqual([revision]);
  expect(wrapper.text()).toContain("old retained answer");
  expect(request.mock.calls.filter(([path]) => path.includes(`revisionId=${revision}`))).toHaveLength(2);
  wrapper.unmount();
});
