// 公开作答页用例：会话生命周期（不预建会话、恢复、过期、满额）、必答拦截、
// markdown 说明块与本地持久化。transport 按 /api/survey-public 路径路由成
// get/start/submit 三支路；renderMarkdown 用测试最小实现（breaks + 粗体）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import SurveyPublicPage from "./SurveyPublicPage.vue";
import { SurveysApiError } from "../host.js";
import { createTestHost, mountSurveysComponent } from "../test-mount.js";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  start: vi.fn(),
  submit: vi.fn(),
}));
const slug = "test-survey-216";
const revisionId = "00000000-0000-4000-8000-000000000001";
const definition = {
  version: 1,
  title: "Research 216",
  description: "A study",
  consent: "Voluntary",
  questions: [
    {
      id: "q1",
      type: "text",
      title: "Your answer",
      required: true,
      maxLength: 20,
    },
  ],
  pages: [{ id: "p1", title: "", questionIds: ["q1"] }],
};
// 测试用最小 markdown 渲染：与主站 renderSafeMarkdown 的 breaks + 段落 + 粗体
// 消费语义对齐，只覆盖用例断言所需的面。
const testMarkdown = (source: string) =>
  source
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p>${block
          .split("\n")
          .join("<br>")
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</p>`,
    )
    .join("");
async function transportRouter(path: string, init?: { method?: string; body?: unknown }) {
  const match = path.match(/^\/api\/survey-public\/([^/]+)(\/(start|responses))?$/);
  if (!match) throw new Error(`transport 未在用例中提供: ${init?.method ?? "GET"} ${path}`);
  const [, target, , action] = match;
  if (!action) return mocks.get(target);
  const body = (init?.body ?? {}) as {
    resumeToken?: string;
    sessionToken?: string;
    answers?: Record<string, unknown>;
    honeypot?: string;
  };
  if (action === "start") return mocks.start(target, body.resumeToken);
  return mocks.submit(target, body.sessionToken, body.answers, body.honeypot);
}
async function render() {
  const host = createTestHost({
    transport: { request: vi.fn(transportRouter) },
    renderMarkdown: testMarkdown,
  });
  const wrapper = mountSurveysComponent(
    SurveyPublicPage,
    { props: { slug } },
    host,
  );
  await flushPromises();
  return wrapper;
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({
    id: revisionId,
    slug,
    status: "published",
    revisionId,
    definition,
  });
  mocks.start.mockResolvedValue({
    sessionToken: "token-216",
    revisionId,
    definition,
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  mocks.submit.mockResolvedValue({
    responseId: revisionId,
    revisionId,
    completedAt: "2026-10-18T00:00:00.000Z",
  });
});
describe("public survey browser lifecycle", () => {
  it("does not create a session merely by loading or previewing a definition", async () => {
    const w = await render();
    expect(mocks.start).not.toHaveBeenCalled();
    const button = w
      .findAll("button")
      .find((b) => b.text() === "开始填写")!;
    expect(button.attributes("disabled")).toBeDefined();
    w.unmount();
  });
  it("requires consent and valid answers, then persists the confirmed receipt", async () => {
    const w = await render();
    await w.find('input[type="checkbox"]').setValue(true);
    await w
      .findAll("button")
      .find((b) => b.text() === "开始填写")!
      .trigger("click");
    await flushPromises();
    expect(mocks.start).toHaveBeenCalledWith(slug, undefined);
    const submit = () =>
      w.findAll("button").find((b) => b.text() === "提交答卷")!;
    await submit().trigger("click");
    await flushPromises();
    expect(mocks.submit).not.toHaveBeenCalled();
    await w.find("input#q1").setValue("Evidence");
    await submit().trigger("click");
    await flushPromises();
    expect(mocks.submit).toHaveBeenCalledWith(
      slug,
      "token-216",
      { q1: "Evidence" },
      "",
    );
    expect(w.text()).toContain("答卷已收到");
    expect(
      JSON.parse(localStorage.getItem("mango-survey:test-survey-216")!).receipt
        .responseId,
    ).toBe(revisionId);
    w.unmount();
  });
  it("resumes the original session instead of binding saved answers to a new revision", async () => {
    localStorage.setItem(
      "mango-survey:test-survey-216",
      JSON.stringify({
        sessionToken: "old-token",
        revisionId,
        answers: { q1: "Original" },
        pageIndex: 0,
      }),
    );
    mocks.get.mockResolvedValue({
      id: revisionId,
      slug,
      status: "published",
      revisionId: "new-revision",
      definition: { ...definition, title: "New publication" },
    });
    const w = await render();
    expect(mocks.start).toHaveBeenCalledWith(slug, "old-token");
    expect(w.text()).toContain("Research 216");
    expect((w.find("input#q1").element as HTMLInputElement).value).toBe(
      "Original",
    );
    w.unmount();
  });
  it("finished sessions reopen to the receipt with a clear re-entry exit (shared-computer scenario)", async () => {
    const w = await render();
    await w.find('input[type="checkbox"]').setValue(true);
    await w
      .findAll("button")
      .find((b) => b.text() === "开始填写")!
      .trigger("click");
    await flushPromises();
    await w.find("input#q1").setValue("Evidence");
    await w
      .findAll("button")
      .find((b) => b.text() === "提交答卷")!
      .trigger("click");
    await flushPromises();
    expect(w.text()).toContain("答卷已收到");
    w.unmount();

    // 服务端以回执为完成凭证：重开链接对已完成会话返回 receipt → 恒显回执页。
    // 出口只清客户端会话存储，防重复机制（服务端按会话发回执）不受影响。
    mocks.start.mockResolvedValue({
      sessionToken: "token-216",
      revisionId,
      definition,
      expiresAt: "2030-01-01T00:00:00.000Z",
      receipt: {
        responseId: revisionId,
        revisionId,
        completedAt: "2026-10-18T00:00:00.000Z",
      },
    });
    const again = await render();
    expect(again.text()).toContain("答卷已收到");
    expect(again.text()).toContain("这台浏览器");
    await again.find(".receipt-again").trigger("click");
    await flushPromises();
    expect(localStorage.getItem("mango-survey:test-survey-216")).toBeNull();
    const start = again
      .findAll("button")
      .find((b) => b.text() === "开始填写")!;
    expect(start.attributes("disabled")).toBeDefined();
    again.unmount();
  });
  it("unchecked consent explains why start is unavailable, and the hint clears once checked", async () => {
    const w = await render();
    expect(w.text()).toContain("勾选同意后才能开始填写。");
    await w.find('input[type="checkbox"]').setValue(true);
    await flushPromises();
    expect(w.text()).not.toContain("勾选同意后才能开始填写。");
    w.unmount();
  });
  it("blocked submit names the missing answer inside the highlighted question card", async () => {
    const choiceDef = {
      ...definition,
      questions: [
        {
          id: "pick",
          type: "single",
          title: "Pick one",
          required: true,
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
        },
      ],
      pages: [{ id: "p1", title: "", questionIds: ["pick"] }],
    };
    mocks.get.mockResolvedValue({
      id: revisionId,
      slug,
      status: "published",
      revisionId,
      definition: choiceDef,
    });
    mocks.start.mockResolvedValue({
      sessionToken: "pick-token",
      revisionId,
      definition: choiceDef,
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    const w = await render();
    await w.find('input[type="checkbox"]').setValue(true);
    await w
      .findAll("button")
      .find((b) => b.text() === "开始填写")!
      .trigger("click");
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text() === "提交答卷")!
      .trigger("click");
    await flushPromises();
    expect(mocks.submit).not.toHaveBeenCalled();
    const slot = w.find(".question-slot--invalid");
    expect(slot.exists()).toBe(true);
    expect(slot.find(".slot-invalid-text").text()).toContain(
      "「Pick one」是必答题，请先作答。",
    );
    w.unmount();
  });
});

it("persists a typed zero before InputNumber loses focus", async () => {
  const numeric = {
    ...definition,
    questions: [
      { id: "hours", type: "number", title: "Hours", required: false },
    ],
    pages: [{ id: "p1", title: "Page", questionIds: ["hours"] }],
  };
  mocks.get.mockResolvedValue({
    id: revisionId,
    slug,
    status: "published",
    revisionId,
    definition: numeric,
  });
  mocks.start.mockResolvedValue({
    sessionToken: "zero-token",
    revisionId,
    definition: numeric,
    expiresAt: "2030-01-01T00:00:00Z",
  });
  const w = await render();
  await w.find('input[type="checkbox"]').setValue(true);
  await w
    .findAll("button")
    .find((button) => button.text() === "开始填写")!
    .trigger("click");
  await flushPromises();
  const input = w.find("input#hours");
  (input.element as HTMLInputElement).focus();
  await input.trigger("keypress", {
    key: "0",
    which: 48,
    charCode: 48,
    keyCode: 48,
  });
  await flushPromises();
  expect((input.element as HTMLInputElement).value).toBe("0");
  expect(
    JSON.parse(localStorage.getItem("mango-survey:test-survey-216")!).answers
      .hours,
  ).toBe(0);
  w.unmount();
  const resumed = await render();
  expect((resumed.find("input#hours").element as HTMLInputElement).value).toBe(
    "0",
  );
  resumed.unmount();
});

it("renders statement bodies as markdown on the answer page", async () => {
  const withStatement = {
    ...definition,
    questions: [
      {
        id: "s1",
        type: "statement",
        title: "",
        required: false,
        body: "**欢迎**参与本研究",
      },
      { ...definition.questions[0], id: "q1" },
    ],
    pages: [{ id: "p1", title: "Page", questionIds: ["s1", "q1"] }],
  };
  mocks.get.mockResolvedValue({
    id: revisionId,
    slug,
    status: "published",
    revisionId,
    definition: withStatement,
  });
  mocks.start.mockResolvedValue({
    sessionToken: "statement-token",
    revisionId,
    definition: withStatement,
    expiresAt: "2030-01-01T00:00:00Z",
  });
  const w = await render();
  await w.find('input[type="checkbox"]').setValue(true);
  await w
    .findAll("button")
    .find((button) => button.text() === "开始填写")!
    .trigger("click");
  await flushPromises();
  // 说明块正文按 markdown 渲染（与编辑端所见一致），且不收集任何输入。
  const body = w.find(".statement-body");
  expect(body.exists()).toBe(true);
  expect(body.html()).toContain("<strong>欢迎</strong>");
  expect(body.find("input,textarea").exists()).toBe(false);
  w.unmount();
});

it("renders the published page order instead of the question storage order", async () => {
  const ordered = {
    ...definition,
    questions: [
      { ...definition.questions[0], id: "second", title: "Second" },
      { ...definition.questions[0], id: "first", title: "First" },
    ],
    pages: [{ id: "p1", title: "Page", questionIds: ["first", "second"] }],
  };
  mocks.start.mockResolvedValue({
    sessionToken: "order-token",
    revisionId,
    definition: ordered,
    expiresAt: "2030-01-01T00:00:00Z",
  });
  const w = await render();
  await w.find('input[type="checkbox"]').setValue(true);
  await w
    .findAll("button")
    .find((button) => button.text() === "开始填写")!
    .trigger("click");
  await flushPromises();
  expect(w.findAll("legend").map((legend) => legend.text())).toEqual([
    "First *",
    "Second *",
  ]);
  w.unmount();
});

it("ignores an old survey load after the host switches to another slug", async () => {
  let resolveOld!: (value: unknown) => void;
  const old = new Promise((resolve) => {
    resolveOld = resolve;
  });
  mocks.get.mockImplementation((target: string) =>
    target === slug
      ? old
      : Promise.resolve({
          id: revisionId,
          slug: target,
          status: "published",
          revisionId,
          definition: { ...definition, title: "Next study" },
        }),
  );
  const w = await render();
  // 宿主持有路由：换 slug 以 prop 变更表达，组件 watch 后重新加载。
  await w.setProps({ slug: "next-survey-216" });
  await flushPromises();
  expect(w.text()).toContain("Next study");
  resolveOld({
    id: revisionId,
    slug,
    status: "published",
    revisionId,
    definition,
  });
  await flushPromises();
  expect(w.text()).toContain("Next study");
  expect(w.text()).not.toContain("Research 216");
  w.unmount();
});

it.each([
  ["paused", false],
  ["closed", true],
])(
  "resumed %s sessions show the correct submission gate",
  async (status, disabled) => {
    localStorage.setItem(
      "mango-survey:test-survey-216",
      JSON.stringify({ sessionToken: "old-token", answers: { q1: "Ready" } }),
    );
    mocks.get.mockResolvedValue({
      id: revisionId,
      slug,
      status,
      revisionId,
      definition,
    });
    const w = await render();
    const button = w
      .findAll("button")
      .find((button) => button.text() === "提交答卷")!;
    expect(button.attributes("disabled") !== undefined).toBe(disabled);
    if (disabled) expect(w.text()).toContain("研究者已关闭问卷");
    w.unmount();
  },
);

it("quota-full landing disables start with a plain hint, and submit failure names the quota (minor②)", async () => {
  // 落地页预提示：开始按钮禁用 + 明确的「名额已满」文案（对齐暂停态的预提示）。
  mocks.get.mockResolvedValue({
    id: revisionId,
    slug,
    status: "published",
    revisionId,
    definition,
    quotaReached: true,
  });
  const w = await render();
  const start = w.findAll("button").find((b) => b.text() === "开始填写")!;
  expect(start.attributes("disabled")).toBeDefined();
  expect(w.text()).toContain("回收名额已满");
  w.unmount();

  // 已有会话在提交时撞上满额：服务端 response_limit_reached 给明确文案，
  // 不是通用失败语。
  localStorage.setItem(
    "mango-survey:test-survey-216",
    JSON.stringify({ sessionToken: "old-token", answers: { q1: "Ready" } }),
  );
  mocks.submit.mockRejectedValue(
    new SurveysApiError(409, "response_limit_reached", null),
  );
  const resumed = await render();
  await resumed
    .findAll("button")
    .find((b) => b.text() === "提交答卷")!
    .trigger("click");
  await flushPromises();
  expect(resumed.text()).toContain("回收名额已满，本次作答无法提交。");
  resumed.unmount();
});

it("requires an explicit fresh start after expiry and clears old local answers only then", async () => {
  mocks.submit.mockRejectedValue(
    new SurveysApiError(409, "session_expired", null),
  );
  const w = await render();
  await w.find('input[type="checkbox"]').setValue(true);
  await w
    .findAll("button")
    .find((button) => button.text() === "开始填写")!
    .trigger("click");
  await flushPromises();
  await w.find("input#q1").setValue("Old answer");
  await w
    .findAll("button")
    .find((button) => button.text() === "提交答卷")!
    .trigger("click");
  await flushPromises();
  expect(w.text()).toContain("本次作答已过期");
  expect(
    JSON.parse(localStorage.getItem("mango-survey:test-survey-216")!).answers
      .q1,
  ).toBe("Old answer");
  await w
    .findAll("button")
    .find((button) => button.text() === "清除本地答案，重新开始")!
    .trigger("click");
  await flushPromises();
  expect(localStorage.getItem("mango-survey:test-survey-216")).toBeNull();
  expect(
    w
      .findAll("button")
      .find((button) => button.text() === "开始填写")!
      .attributes("disabled"),
  ).toBeDefined();
  w.unmount();
});

it("uses the server receipt as completion authority and tolerates invalid local draft data", async () => {
  localStorage.setItem(
    "mango-survey:test-survey-216",
    JSON.stringify({
      sessionToken: "old-token",
      answers: "invalid-local-state",
      pageIndex: 999,
      receipt: { responseId: revisionId },
    }),
  );
  const w = await render();
  expect(w.text()).not.toContain("答卷已收到");
  expect(w.find("input#q1").exists()).toBe(true);
  expect(w.text()).toContain("第 1 / 1 页");
  w.unmount();
});

it("next-page interception names the first unanswered required question and stays put", async () => {
  const twoPage = {
    ...definition,
    questions: [
      { id: "qA", type: "text", title: "First required", required: true, maxLength: 20 },
      { id: "qB", type: "text", title: "Second required", required: true, maxLength: 20 },
    ],
    pages: [
      { id: "p1", title: "Page one", questionIds: ["qA"] },
      { id: "p2", title: "Page two", questionIds: ["qB"] },
    ],
  };
  mocks.get.mockResolvedValue({
    id: revisionId,
    slug,
    status: "published",
    revisionId,
    definition: twoPage,
  });
  mocks.start.mockResolvedValue({
    sessionToken: "intercept-token",
    revisionId,
    definition: twoPage,
    expiresAt: "2030-01-01T00:00:00Z",
  });
  const w = await render();
  await w.find('input[type="checkbox"]').setValue(true);
  await w
    .findAll("button")
    .find((button) => button.text() === "开始填写")!
    .trigger("click");
  await flushPromises();

  const next = () =>
    w.findAll("button").find((button) => button.text() === "下一页")!;
  await next().trigger("click");
  await flushPromises();
  // 拦截语指出第一条未通过的题干，且没有翻页。
  expect(w.text()).toContain("「First required」是必答题，请先作答。");
  expect(w.text()).toContain("第 1 / 2 页");

  // 第一题作答后可翻页；最后一页提交时拦截语指向仍未答的第二题。
  await w.find("input#qA").setValue("Done");
  await next().trigger("click");
  await flushPromises();
  expect(w.text()).toContain("第 2 / 2 页");
  const submit = () =>
    w.findAll("button").find((button) => button.text() === "提交答卷")!;
  await submit().trigger("click");
  await flushPromises();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(w.text()).toContain("「Second required」是必答题，请先作答。");
  w.unmount();
});

it("matrix interception names the unanswered row and marks its row card", async () => {
  const matrixDef = {
    ...definition,
    questions: [
      {
        id: "qm",
        type: "matrix_single",
        title: "Teaching quality",
        required: true,
        rows: [
          { id: "r1", label: "Interaction" },
          { id: "r2", label: "Pacing" },
        ],
        columns: [
          { id: "c1", label: "Disagree" },
          { id: "c2", label: "Agree" },
        ],
      },
    ],
    pages: [{ id: "p1", title: "Page", questionIds: ["qm"] }],
  };
  mocks.get.mockResolvedValue({
    id: revisionId,
    slug,
    status: "published",
    revisionId,
    definition: matrixDef,
  });
  mocks.start.mockResolvedValue({
    sessionToken: "matrix-token",
    revisionId,
    definition: matrixDef,
    expiresAt: "2030-01-01T00:00:00Z",
  });
  const w = await render();
  await w.find('input[type="checkbox"]').setValue(true);
  await w
    .findAll("button")
    .find((button) => button.text() === "开始填写")!
    .trigger("click");
  await flushPromises();
  const submit = () =>
    w.findAll("button").find((button) => button.text() === "提交答卷")!;
  await submit().trigger("click");
  await flushPromises();
  // 拦截语指名漏答行，而不是只说「这题必答」；行卡就地标红。
  expect(w.text()).toContain("「Teaching quality」还有未作答的行：Interaction");
  expect(w.findAll(".mx-row--invalid")).toHaveLength(1);
  // 答完第一行后再提交：拦截指向剩下的行。
  await w
    .findAll(".mx-row")[0]!
    .findAll(".mx-cell input")[1]!
    .setValue(true);
  await submit().trigger("click");
  await flushPromises();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(w.text()).toContain("「Teaching quality」还有未作答的行：Pacing");
  w.unmount();
});

it("legacy plain-text notices keep their single newlines under markdown rendering", async () => {
  mocks.get.mockResolvedValue({
    id: revisionId,
    slug,
    status: "published",
    revisionId,
    definition: {
      ...definition,
      description: "研究简介第一行\n第二行\n\n第二段",
      consent: "参与须知 A\n参与须知 B",
    },
  });
  const w = await render();
  const blocks = w.findAll(".description-preview");
  expect(blocks).toHaveLength(2);
  const descriptionHtml = blocks[0]!.html();
  // breaks: true：老问卷纯文本的单换行在 markdown 渲染下仍成行，不并成一段。
  expect(descriptionHtml).toContain("<br");
  expect(descriptionHtml).toContain("第一行");
  expect(descriptionHtml).toContain("第二行");
  expect(descriptionHtml).toContain("<p>第二段</p>");
  const consentHtml = blocks[1]!.html();
  expect(consentHtml).toContain("参与须知 A");
  expect(consentHtml).toContain("<br");
  expect(consentHtml).toContain("参与须知 B");
  w.unmount();
});
