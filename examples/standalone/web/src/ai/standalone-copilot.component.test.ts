// @vitest-environment happy-dom
import { createApp, defineComponent, h, onUnmounted } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolSurveyDelivery } from "@mango-write/surveys/vue";

import { createStandaloneCopilot } from "./standalone-copilot";

const SURVEY_ID = "11111111-2222-5311-8111-111111111111";
const review: ToolSurveyDelivery = {
  type: "survey_review",
  surveyId: SURVEY_ID,
  operationId: "review-component-1",
  baseDraftVersion: 2,
  summary: "需要明确时间范围",
  findings: [{
    id: "f1",
    checkId: "wording.timeframe",
    questionId: "q1",
    title: "缺少时间范围",
    severity: "major",
    reason: "题干没有时间范围",
    recommendation: "限定过去一个月",
    suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "过去一个月的使用频率" } }],
  }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function mountBridge(copilot: ReturnType<typeof createStandaloneCopilot>, received: ToolSurveyDelivery[]) {
  let activeSurveyId = SURVEY_ID;
  let request: Promise<void> | null = null;
  const Fixture = defineComponent({
    setup() {
      const unregister = copilot.host.registerHandlers(
        { onSurveyDeliveryFrame: (delivery) => received.push(delivery) },
        { surface: () => ({ kind: "survey", id: activeSurveyId }) },
      );
      onUnmounted(unregister);
      return () => h("button", {
        onClick: () => {
          request = copilot.host.sendPrompt!("请专业审查当前问卷", ["survey_read", "survey_review"]);
        },
      }, "专业审查");
    },
  });
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp(Fixture);
  app.mount(root);
  return {
    app,
    click: () => root.querySelector("button")!.dispatchEvent(new MouseEvent("click")),
    request: () => request,
    changeSurvey: (id: string) => { activeSurveyId = id; },
  };
}

describe("独立站专业审查组件桥", () => {
  it("点击后请求当前问卷并把结构化审查交给既有页面处理器，不填建卷 brief", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(review), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const copilot = createStandaloneCopilot();
    const received: ToolSurveyDelivery[] = [];
    const fixture = mountBridge(copilot, received);

    fixture.click();
    await fixture.request();

    expect(fetchMock).toHaveBeenCalledWith("/api/ai/review", expect.objectContaining({
      method: "POST",
      credentials: "include",
    }));
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      surveyId: SURVEY_ID,
      prompt: "请专业审查当前问卷",
      operationId: expect.any(String),
    });
    expect(received).toEqual([review]);
    expect(copilot.state.open).toBe(false);
    expect(copilot.state.brief).toBe("");
    expect(copilot.state.busy).toBe(false);
    fixture.app.unmount();
  });

  it("非审查提示保持原建卷面板行为", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const copilot = createStandaloneCopilot();
    await copilot.host.sendPrompt!("生成一份问卷", ["survey_read", "survey_edit"]);
    expect(copilot.state.open).toBe(true);
    expect(copilot.state.brief).toBe("生成一份问卷");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("失败响应如实抛出且不交付；切卷后的迟到结果不投给新问卷", async () => {
    const copilot = createStandaloneCopilot();
    const received: ToolSurveyDelivery[] = [];
    const failure = mountBridge(copilot, received);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "model_failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    })));
    failure.click();
    await expect(failure.request()).rejects.toMatchObject({ status: 502 });
    expect(received).toHaveLength(0);
    expect(copilot.state.error).toBe("review_failed");
    failure.app.unmount();

    let resolveResponse: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; })));
    const pending = mountBridge(copilot, received);
    pending.click();
    pending.changeSurvey("22222222-2222-5311-8111-111111111111");
    resolveResponse!(new Response(JSON.stringify(review), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await pending.request();
    expect(received).toHaveLength(0);
    pending.app.unmount();
  });
});
