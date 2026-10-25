// 工作区活流收到 survey_create 交付帧的端到端接线（issue #217）：帧 → 载荷
// 交接 + 导航 + 落地提示卡。独立成文件的原因：copilot 桥是宿主级单例，
// emit 广播给**所有**已注册 handler——主测试文件的历史用例不卸载实例，残留
// 的陈旧页面会在 load() 里把单槽交接先取走；这条用例需要无残留的注册表，
// 全部实例即挂即卸。包页面不感知 copilot-island 内部：帧经测试自己的
// host.copilot 实现直接派发给页面登记的 handler。
import { defineComponent, h, useSlots } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";

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

// confirm 全 mock：本用例不弹确认，require 只需存在（mountSurveysComponent
// 不装 ConfirmationService，与主工作区测试同一做法）。
vi.mock("primevue/useconfirm", () => ({
  useConfirm: () => ({ require: () => {} }),
}));

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
        return () => {};
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
});
