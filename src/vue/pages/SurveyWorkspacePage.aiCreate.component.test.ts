// 工作区活流收到 survey_create 交付帧的端到端接线（issue #217）：帧 → 载荷
// 交接 + 导航 + 落地提示卡。独立成文件的原因：copilot 桥是宿主级单例，
// emit 广播给**所有**已注册 handler——主测试文件的历史用例不卸载实例，残留
// 的陈旧页面会在 load() 里把单槽交接先取走；这条用例需要无残留的注册表，
// 全部实例即挂即卸。包页面不感知 copilot-island 内部：帧经测试自己的
// host.copilot 实现直接派发给页面登记的 handler。
import { KeepAlive, defineComponent, h, ref, useSlots } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { RouterView, createMemoryHistory, createRouter, useRoute } from "vue-router";

import { createSurveysTestI18n, createTestHost, mountSurveysComponent } from "../test-mount.js";
import type { SurveysCopilotHandlers, SurveysWebHost } from "../host.js";
import type { SurveyDefinition, SurveyDetail, ToolSurveyDelivery } from "../../contracts/index.js";
import {
  __resetAiCreatedSurveyHandoffForTest,
  takeAiCreatedSurveyHandoff,
} from "../lib/ai-created-handoff.js";

import SurveyWorkspacePage from "./SurveyWorkspacePage.vue";

const i18n = createSurveysTestI18n();

const t = (key: string, params?: Record<string, unknown>) =>
  i18n.global.t(key, params as never);

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

// confirm 全 mock：本用例不弹确认，require 只需存在（与主工作区测试同一做法）。
vi.mock("@mango-write/ui-vue/lib/confirm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mango-write/ui-vue/lib/confirm")>();
  return {
    ...actual,
    useConfirm: () => ({ require: () => {} }),
  };
});

const ShellStub = defineComponent({
  name: "SurveyWorkbenchShell",
  props: { tabs: { type: Array, default: () => [] } },
  setup() {
    const slots = useSlots();
    return () =>
      h("div", { class: "workbench-shell-stub" }, [
        h("div", { class: "stub-left" }, slots.left?.({ activeTab: "outline" })),
        h("div", { class: "stub-center" }, slots.center?.()),
      ]);
  },
});
const CanvasStub = defineComponent({
  name: "SurveyDesignCanvas",
  props: ["modelValue", "disabled", "activeQuestionId", "surveyId"],
  emits: ["change", "select"],
  template: '<div class="canvas-stub" />',
});

function definition(): SurveyDefinition {
  return {
    version: 1,
    title: "问卷",
    description: "",
    consent: "",
    questions: [{ id: "q1", type: "text", title: "备注", required: false }],
    pages: [{ id: "p1", title: "第一页", questionIds: ["q1"] }],
  };
}

function detail(): SurveyDetail {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "owner",
    teamId: null,
    title: "问卷",
    slug: "aB3-xY9_qW12zK8vN",
    status: "draft",
    currentRevisionId: null,
    draftVersion: 2,
    completedCount: 5,
    startedCount: 8,
    responseLimit: 5000,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    definition: definition(),
    revisions: [],
    canWrite: true,
    canDelete: true,
  };
}

async function mountWorkspace() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/u/surveys/:surveyId",
        name: "u.surveys.detail",
        component: { template: "<div/>" },
      },
      { path: "/u/surveys", name: "u.surveys.list", component: { template: "<div/>" } },
    ],
  });
  await router.push("/u/surveys/s-1");
  const navigate = vi.fn();
  const copilot: SurveysCopilotHandlers[] = [];
  const host: SurveysWebHost = createTestHost({
    transport: {
      request: (async (path: string) => {
        if (path.split("/").at(-1) === "s-1") return mocks.get(path);
        throw new Error(`用例未覆盖的 transport 请求：${path}`);
      }) as never,
    },
    navigate: navigate as never,
    copilot: {
      registerHandlers: (handlers) => {
        copilot.push(handlers);
        return () => {
          const idx = copilot.indexOf(handlers);
          if (idx >= 0) copilot.splice(idx, 1);
        };
      },
      setContextRefs: () => {},
      fillComposer: () => {},
      focusComposer: () => {},
      releasePageState: () => {},
    },
  });
  const wrapper = mountSurveysComponent(
    SurveyWorkspacePage,
    { global: { plugins: [router], stubs: { SurveyWorkbenchShell: ShellStub, SurveyDesignCanvas: CanvasStub } } },
    host,
  );
  await router.isReady();
  await flushPromises();
  return { navigate, copilot, wrapper };
}

function emitSurveyFrame(copilot: SurveysCopilotHandlers[], frame: ToolSurveyDelivery) {
  for (const handlers of copilot) handlers.onSurveyDeliveryFrame?.(frame);
}

const CREATED_ID = "00000000-0000-4000-8000-0000000000c1";

describe("SurveyWorkspacePage 活流 survey_create 帧（issue #217）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAiCreatedSurveyHandoffForTest();
    mocks.get.mockResolvedValue(detail());
  });
  afterEach(() => __resetAiCreatedSurveyHandoffForTest());

  it("帧 → 载荷交接 + 导航到新卷（AI 刚建了什么由新工作区落地提示卡接手）", async () => {
    const { navigate, copilot, wrapper } = await mountWorkspace();
    emitSurveyFrame(copilot, {
      type: "survey_create",
      surveyId: CREATED_ID,
      operationId: "op-ws-create",
      title: "会上新建的问卷",
    });
    await flushPromises();
    expect(navigate).toHaveBeenCalledWith({ name: "surveys.detail", surveyId: CREATED_ID });
    // 载荷已交接进单槽：新工作区 load(s-1 → CREATED_ID) 后取走展示。
    expect(takeAiCreatedSurveyHandoff(CREATED_ID)?.title).toBe("会上新建的问卷");
    wrapper.unmount();
  });

  it("survey_edit 帧不触发建卷导航（重放是本卷工作区的职责）", async () => {
    const { navigate, copilot, wrapper } = await mountWorkspace();
    emitSurveyFrame(copilot, {
      type: "survey_edit",
      surveyId: "other-survey",
      operationId: "op-ws-edit",
      baseDraftVersion: 2,
      summary: "改了一题",
      appliedOps: [],
    });
    await flushPromises();
    expect(navigate).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("KeepAlive 失活时注销 handler 并屏蔽迟到 survey_edit / survey_review 帧，重新激活后恢复接收", async () => {
    const surveyS1 = { ...detail(), id: "s-1" };
    mocks.get.mockResolvedValue(surveyS1);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/u/surveys/:surveyId", name: "u.surveys.detail", component: { template: "<div/>" } },
      ],
    });
    await router.push("/u/surveys/s-1");
    const copilot: SurveysCopilotHandlers[] = [];
    const patchCalls: unknown[] = [];
    const release = vi.fn();
    const host: SurveysWebHost = createTestHost({
      transport: {
        request: (async (path: string, init?: { method?: string; body?: unknown }) => {
          if (init?.method === "PATCH") {
            patchCalls.push(init.body);
            return { ...surveyS1, draftVersion: 3 };
          }
          return mocks.get(path);
        }) as never,
      },
      navigate: vi.fn() as never,
      copilot: {
        registerHandlers: (handlers) => {
          copilot.push(handlers);
          return () => {
            const idx = copilot.indexOf(handlers);
            if (idx >= 0) copilot.splice(idx, 1);
          };
        },
        setContextRefs: () => {},
        fillComposer: () => {},
        focusComposer: () => {},
        releasePageState: release,
      },
    });
    const activeView = ref<"survey" | "other">("survey");
    const OtherStub = defineComponent({ render: () => h("div", "other-plugin") });
    const Harness = defineComponent({
      setup() {
        return () =>
          h(KeepAlive, null, [
            activeView.value === "survey"
              ? h(SurveyWorkspacePage, { key: "survey-s1" })
              : h(OtherStub, { key: "other" }),
          ]);
      },
    });
    const wrapper = mountSurveysComponent(
      Harness,
      { global: { plugins: [router], stubs: { SurveyWorkbenchShell: ShellStub, SurveyDesignCanvas: CanvasStub } } },
      host,
    );
    await router.isReady();
    await flushPromises();
    expect(copilot).toHaveLength(1);

    // 切到其他插件标签 → 失活注销 handler 并带 owner 令牌清理桥面状态
    activeView.value = "other";
    await flushPromises();
    expect(copilot).toHaveLength(0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(typeof release.mock.calls[0]![0]).toBe("symbol");

    // 失活期间派发迟到的 survey_edit 与 survey_review 帧，不应触发保存或修改
    emitSurveyFrame(copilot, {
      type: "survey_edit",
      surveyId: "s-1",
      operationId: "op-late-edit",
      baseDraftVersion: 2,
      summary: "迟到改题",
      appliedOps: [{ op: "update_question", questionId: "q1", patch: { title: "被后台篡改" } }],
    });
    emitSurveyFrame(copilot, {
      type: "survey_review",
      surveyId: "s-1",
      operationId: "op-late-review",
      baseDraftVersion: 2,
      summary: "迟到审阅",
      findings: [],
    });
    await flushPromises();
    expect(patchCalls).toHaveLength(0);

    // 重新切回问卷标签 → 恢复注册 handler
    activeView.value = "survey";
    await flushPromises();
    expect(copilot).toHaveLength(1);
    wrapper.unmount();
  });

  it("失活期间服务端已原子落盘新版本：KeepAlive 重新激活时自动对账拉取最新题干且不发冗余 PATCH，支持撤销回退", async () => {
    const surveyA = { ...detail(), id: "s-1", draftVersion: 2 };
    let remoteState: SurveyDetail = surveyA;
    mocks.get.mockImplementation(async () => structuredClone(remoteState));

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/u/surveys/:surveyId", name: "u.surveys.detail", component: { template: "<div/>" } },
      ],
    });
    await router.push("/u/surveys/s-1");
    const patchCalls: Array<{ expectedVersion: number; definition: SurveyDefinition }> = [];
    const host: SurveysWebHost = createTestHost({
      transport: {
        request: (async (path: string, init?: { method?: string; body?: unknown }) => {
          if (init?.method === "PATCH") {
            const body = init.body as { expectedVersion: number; definition: SurveyDefinition };
            patchCalls.push(body);
            remoteState = {
              ...remoteState,
              draftVersion: body.expectedVersion + 1,
              definition: body.definition,
            };
            return structuredClone(remoteState);
          }
          return mocks.get(path);
        }) as never,
      },
      navigate: vi.fn() as never,
      copilot: {
        registerHandlers: () => () => {},
        setContextRefs: () => {},
        fillComposer: () => {},
        focusComposer: () => {},
        releasePageState: () => {},
      },
    });

    const activeTab = ref<"a" | "b">("a");
    const TabBStub = defineComponent({ render: () => h("div", "survey-b") });
    const Harness = defineComponent({
      setup() {
        return () =>
          h(KeepAlive, null, [
            activeTab.value === "a"
              ? h(SurveyWorkspacePage, { key: "survey-a" })
              : h(TabBStub, { key: "survey-b" }),
          ]);
      },
    });

    const wrapper = mountSurveysComponent(
      Harness,
      { global: { plugins: [router], stubs: { SurveyWorkbenchShell: ShellStub, SurveyDesignCanvas: CanvasStub } } },
      host,
    );
    await router.isReady();
    await flushPromises();
    expect(wrapper.findComponent(CanvasStub).props("modelValue").questions[0].title).toBe("备注");

    // 1) A 发起改卷后立即切到 B 标签（A 进入 KeepAlive 失活态）
    activeTab.value = "b";
    await flushPromises();

    // 2) A 失活期间，服务端 survey_edit 完成原子落库（draftVersion 2 → 3，题干更新）
    remoteState = {
      ...surveyA,
      draftVersion: 3,
      title: "问卷",
      definition: {
        ...definition(),
        questions: [{ id: "q1", type: "text", title: "失活期间服务端已更新的新题干", required: false }],
      },
    };

    // 3) 切回 A 标签 → onActivated 自动对账拉取远端 v3，画布无需整页刷新即展示新题干，且不发多余 PATCH
    vi.useFakeTimers();
    activeTab.value = "a";
    await flushPromises();
    expect(wrapper.findComponent(CanvasStub).props("modelValue").questions[0].title).toBe(
      "失活期间服务端已更新的新题干",
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(patchCalls).toHaveLength(0);

    // 4) 用户点击撤销可回退到修改前的「备注」，并以 expectedVersion=3 落盘
    const undoBtn = wrapper.findAll("button").find((b) => b.attributes("aria-label") === t("surveys.undo"))!;
    expect(undoBtn.attributes("disabled")).toBeUndefined();
    await undoBtn.trigger("click");
    await vi.advanceTimersByTimeAsync(1600);
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0]!.expectedVersion).toBe(3);
    expect(patchCalls[0]!.definition.questions[0]!.title).toBe("备注");
    vi.useRealTimers();
    wrapper.unmount();
  });

  it("真实 RouterView + KeepAlive 多问卷路由参数切换（A -> B -> /u/write -> A）：失活实例冻结绑定 surveyId 不触发全量 load，切回走 reconcileOnActivated 且撤销按钮可用", async () => {
    const stateById: Record<string, SurveyDetail> = {
      "s-a": {
        ...detail(),
        id: "s-a",
        title: "问卷 A",
        draftVersion: 2,
        definition: {
          ...definition(),
          title: "问卷 A",
          questions: [{ id: "q1", type: "text", title: "A 初始题干", required: false }],
        },
      },
      "s-b": {
        ...detail(),
        id: "s-b",
        title: "问卷 B",
        draftVersion: 5,
        definition: {
          ...definition(),
          title: "问卷 B",
          questions: [{ id: "q1", type: "text", title: "B 初始题干", required: false }],
        },
      },
    };
    const getCalls: string[] = [];
    const patchCalls: Array<{ id: string; expectedVersion: number; definition: SurveyDefinition }> = [];

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/u/surveys/:surveyId", name: "u.surveys.detail", component: SurveyWorkspacePage },
        { path: "/u/write/:draftId", name: "u.writer", component: defineComponent({ render: () => h("div", "writer-page") }) },
      ],
    });
    await router.push("/u/surveys/s-a");
    await router.isReady();

    const host: SurveysWebHost = createTestHost({
      workbenchShell: defineComponent({ render: () => h("div") }),
      transport: {
        request: (async (path: string, init?: { method?: string; body?: unknown }) => {
          const id = path.split("/").filter(Boolean).at(-1)!;
          if (init?.method === "PATCH") {
            const body = init.body as { expectedVersion: number; definition: SurveyDefinition };
            patchCalls.push({ id, ...body });
            stateById[id] = {
              ...stateById[id]!,
              draftVersion: body.expectedVersion + 1,
              definition: body.definition,
            };
            return structuredClone(stateById[id]!);
          }
          getCalls.push(id);
          return structuredClone(stateById[id]!);
        }) as never,
      },
      navigate: vi.fn() as never,
      copilot: {
        registerHandlers: () => () => {},
        setContextRefs: () => {},
        fillComposer: () => {},
        focusComposer: () => {},
        releasePageState: () => {},
      },
    });

    // 完整复刻 WorkspaceShell 的 RouterView + KeepAlive(:key="scopedPageKey") 拓扑
    const KeepAliveRouterShell = defineComponent({
      setup() {
        const route = useRoute();
        return () =>
          h(RouterView, null, {
            default: ({ Component }: { Component?: ReturnType<typeof defineComponent> }) =>
              h(KeepAlive, { max: 8 }, [
                Component
                  ? h(Component, {
                      key:
                        route.name === "u.surveys.detail"
                          ? `surveys:${String(route.params.surveyId)}`
                          : `route:${String(route.fullPath)}`,
                    })
                  : null,
              ]),
          });
      },
    });

    const wrapper = mountSurveysComponent(
      KeepAliveRouterShell,
      { global: { plugins: [router], stubs: { SurveyWorkbenchShell: ShellStub, SurveyDesignCanvas: CanvasStub } } },
      host,
    );
    await flushPromises();
    expect(getCalls).toEqual(["s-a"]);
    expect(wrapper.findComponent(CanvasStub).props("modelValue").questions[0].title).toBe("A 初始题干");

    // 1) 从问卷 A 切到问卷 B：A 失活冻结自身 surveyId，绝不对 s-b 发重复 GET 或重置历史栈
    await router.push("/u/surveys/s-b");
    await flushPromises();
    expect(getCalls).toEqual(["s-a", "s-b"]);
    expect(wrapper.findComponent(CanvasStub).props("modelValue").questions[0].title).toBe("B 初始题干");

    // 再切到跨模块路由 /u/write/d-1（此时 route.params.surveyId 为 undefined）
    await router.push("/u/write/d-1");
    await flushPromises();
    expect(getCalls).toEqual(["s-a", "s-b"]);

    // 2) 后台服务端完成对问卷 A 的修改（draftVersion 2 -> 3）
    stateById["s-a"] = {
      ...stateById["s-a"]!,
      draftVersion: 3,
      definition: {
        ...stateById["s-a"]!.definition,
        questions: [{ id: "q1", type: "text", title: "A 服务端已落盘新题干", required: false }],
      },
    };

    // 3) 切回问卷 A：走 reconcileOnActivated 推入 assistant 历史，不触发 load() 重置历史，顶栏撤销按钮必须可用！
    vi.useFakeTimers();
    await router.push("/u/surveys/s-a");
    await flushPromises();
    expect(getCalls).toEqual(["s-a", "s-b", "s-a"]);
    expect(wrapper.findComponent(CanvasStub).props("modelValue").questions[0].title).toBe("A 服务端已落盘新题干");

    const undoBtn = wrapper.findAll("button").find((b) => b.attributes("aria-label") === t("surveys.undo"))!;
    expect(undoBtn.attributes("disabled")).toBeUndefined();

    // 4) 点撤销回退到「A 初始题干」并以 expectedVersion=3 写回服务端；问卷 B 完全未受影响
    await undoBtn.trigger("click");
    await vi.advanceTimersByTimeAsync(1600);
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0]).toMatchObject({
      id: "s-a",
      expectedVersion: 3,
    });
    expect(patchCalls[0]!.definition.questions[0]!.title).toBe("A 初始题干");
    expect(stateById["s-b"]!.definition.questions[0]!.title).toBe("B 初始题干");
    vi.useRealTimers();
    wrapper.unmount();
  });
});
