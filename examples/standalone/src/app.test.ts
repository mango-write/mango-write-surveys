// 独立站应用层验收：AI 建卷/审查、surveys 管理面与研究数据面同一道管理员会话闸。
// 覆盖匿名 401、建卷落盘、审查读取与结构化交付、限次、503、参数校验与研究面 401/200；
// 依赖全部注入桩，不落 PG、不发起网络。
import { describe, expect, it, vi } from "vitest";

import type { SurveyModelPort } from "@mango-write/surveys/ai";
import type { ResearchRouterDeps, SurveysRouterDeps } from "@mango-write/surveys/server";

import { buildStandaloneApp } from "./app";

const SURVEY_ID = "11111111-2222-5311-8111-111111111111";
const ADMIN_PASSWORD = "recheck-p1";

const baseDefinition = {
  version: 1,
  title: "测试问卷",
  description: "",
  consent: "",
  questions: [
    {
      id: "q1",
      type: "single",
      title: "单选",
      required: true,
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    },
  ],
  pages: [{ id: "p1", title: "页", questionIds: ["q1"] }],
};

function stubDeps() {
  return {
    service: {
      requireSurveyAccess: vi.fn(async () => ({
        status: "draft",
        draftVersion: 2,
        draftJson: baseDefinition,
      })),
      createSurvey: vi.fn(),
      updateSurvey: vi.fn(),
      recordReview: vi.fn(async () => null),
    },
    collection: { listCollections: vi.fn() },
    media: { uploadImage: vi.fn() },
    actorOf: vi.fn(() => ({ userId: "standalone-admin", space: { kind: "personal" } })),
  } as unknown as SurveysRouterDeps & {
    service: {
      createSurvey: ReturnType<typeof vi.fn>;
      updateSurvey: ReturnType<typeof vi.fn>;
      recordReview: ReturnType<typeof vi.fn>;
    };
  };
}

function stubModel() {
  return {
    complete: vi.fn(async () => ({ text: JSON.stringify(baseDefinition) })),
  } as unknown as SurveyModelPort & { complete: ReturnType<typeof vi.fn> };
}

/** 研究数据面桩：只实现被测路由触达的方法，其余按 ResearchService 形状占位。 */
function stubResearch() {
  return {
    service: {
      listDatasets: vi.fn(async () => []),
    },
    actorOf: vi.fn(() => ({ userId: "standalone-admin", space: { kind: "personal" } })),
  } as unknown as Pick<ResearchRouterDeps, "service" | "actorOf"> & {
    service: { listDatasets: ReturnType<typeof vi.fn> };
  };
}

const reviewArgs = {
  baseDraftVersion: 2,
  summary: "题干需要明确时间范围",
  findings: [{
    id: "f1",
    checkId: "wording.timeframe",
    questionId: "q1",
    title: "缺少时间范围",
    severity: "major",
    reason: "当前题干没有回答时间范围",
    recommendation: "限定为过去一个月",
    suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "过去一个月的单选" } }],
  }],
};

function stubReviewModel() {
  const model = stubModel();
  model.complete.mockResolvedValue({ text: `\`\`\`json\n${JSON.stringify(reviewArgs)}\n\`\`\`` });
  return model;
}

async function postReview(
  app: ReturnType<typeof buildStandaloneApp>,
  operationId: string,
  cookie?: string,
) {
  return app.request("/api/ai/review", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ surveyId: SURVEY_ID, operationId, prompt: "请专业审查当前问卷" }),
  });
}

/** 登录拿会话 cookie（app.request 直连，不起端口）。 */
async function login(app: ReturnType<typeof buildStandaloneApp>): Promise<string> {
  const res = await app.request("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  expect(res.status).toBe(200);
  const [cookie] = res.headers.getSetCookie();
  return cookie!.split(";")[0]!;
}

describe("独立站鉴权边界", () => {
  it("匿名 /api/ai/generate 401：模型与存储都在它之后，一个都不能被触达", async () => {
    const deps = stubDeps();
    const model = stubModel();
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: model,
      aiTimeoutMs: 5_000,
      routerDeps: deps,
      research: stubResearch(),
    });

    const res = await app.request("/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "匿名建卷", brief: "x".repeat(10), operationId: "op-anonymous-1" }),
    });
    expect(res.status).toBe(401);
    expect(model.complete).not.toHaveBeenCalled();
    expect(deps.service.createSurvey).not.toHaveBeenCalled();
  });

  it("匿名 surveys 管理面仍 401（回归）", async () => {
    const deps = stubDeps();
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: null,
      aiTimeoutMs: 5_000,
      routerDeps: deps,
      research: stubResearch(),
    });
    const res = await app.request("/api/surveys");
    expect(res.status).toBe(401);
  });

  it("登录后 AI 建卷：模型生成 + 幂等建卷 + 存草稿定义", async () => {
    const deps = stubDeps();
    const model = stubModel();
    deps.service.createSurvey.mockResolvedValueOnce({ id: SURVEY_ID, draftVersion: 1 });
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: model,
      aiTimeoutMs: 5_000,
      routerDeps: deps,
      research: stubResearch(),
    });
    const cookie = await login(app);

    const res = await app.request("/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ title: "测试问卷", brief: "一道单选的问卷", operationId: "op-logged-in-1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; surveyId: string };
    expect(body).toEqual({ ok: true, surveyId: SURVEY_ID });
    expect(model.complete).toHaveBeenCalledTimes(1);
    expect(deps.service.createSurvey).toHaveBeenCalledWith(
      { userId: "standalone-admin", space: { kind: "personal" } },
      {
        title: "测试问卷",
        idempotentSurveyId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      },
    );
    expect(deps.service.updateSurvey).toHaveBeenCalledWith("standalone-admin", SURVEY_ID, {
      expectedVersion: 1,
      definition: expect.objectContaining({ title: "测试问卷" }),
    });
  });

  it("未配置 AI：登录后也 503，且不触达存储", async () => {
    const deps = stubDeps();
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: null,
      aiTimeoutMs: 5_000,
      routerDeps: deps,
      research: stubResearch(),
    });
    const cookie = await login(app);
    const res = await app.request("/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ title: "测试问卷", brief: "x".repeat(10), operationId: "op-no-model-1" }),
    });
    expect(res.status).toBe(503);
    expect(deps.service.createSurvey).not.toHaveBeenCalled();
  });

  it("登录后缺必填参数 400（operationId ≥6、title/brief 非空）", async () => {
    const deps = stubDeps();
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: stubModel(),
      aiTimeoutMs: 5_000,
      routerDeps: deps,
      research: stubResearch(),
    });
    const cookie = await login(app);
    const res = await app.request("/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ title: "", brief: "x".repeat(10), operationId: "op-too-short" }),
    });
    expect(res.status).toBe(400);
  });

  it("匿名专业审查 401：不能读取草稿或触达模型", async () => {
    const deps = stubDeps();
    const model = stubReviewModel();
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: model,
      aiTimeoutMs: 5_000,
      routerDeps: deps,
      research: stubResearch(),
    });
    const res = await postReview(app, "review-anonymous-1");
    expect(res.status).toBe(401);
    expect(deps.service.requireSurveyAccess).not.toHaveBeenCalled();
    expect(model.complete).not.toHaveBeenCalled();
  });

  it("登录后专业审查：读取当前草稿、一次模型调用并返回包内校验后的交付帧", async () => {
    const deps = stubDeps();
    const model = stubReviewModel();
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: model,
      aiTimeoutMs: 5_000,
      routerDeps: deps,
      research: stubResearch(),
    });
    const cookie = await login(app);
    const res = await postReview(app, "review-success-1", cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      type: "survey_review",
      surveyId: SURVEY_ID,
      operationId: "review-success-1",
      baseDraftVersion: 2,
      summary: reviewArgs.summary,
      findings: [{ id: "f1", suggestedOps: reviewArgs.findings[0]!.suggestedOps }],
    });
    expect(deps.service.requireSurveyAccess).toHaveBeenCalledWith("standalone-admin", SURVEY_ID, "read");
    expect(model.complete).toHaveBeenCalledTimes(1);
    expect(model.complete.mock.calls[0]![0]).toMatchObject({ timeoutMs: 5_000 });
    expect(model.complete.mock.calls[0]![0].user).toContain('"draftVersion":2');
    expect(model.complete.mock.calls[0]![0].user).toContain("测试问卷");
    expect(deps.service.updateSurvey).not.toHaveBeenCalled();
  });

  it("专业审查限次：窗口内超额请求 429，不再调用模型", async () => {
    const deps = stubDeps();
    const model = stubReviewModel();
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: model,
      aiTimeoutMs: 5_000,
      aiReviewLimit: 1,
      routerDeps: deps,
      research: stubResearch(),
    });
    const cookie = await login(app);
    expect((await postReview(app, "review-limit-1", cookie)).status).toBe(200);
    const limited = await postReview(app, "review-limit-2", cookie);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "rate_limited" });
    expect(model.complete).toHaveBeenCalledTimes(1);
  });

  it("模型没有返回审查 JSON 时 502，不伪造诊断交付", async () => {
    const deps = stubDeps();
    const model = stubModel();
    model.complete.mockResolvedValue({ text: "无法完成审查" });
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: model,
      aiTimeoutMs: 5_000,
      routerDeps: deps,
      research: stubResearch(),
    });
    const cookie = await login(app);
    const res = await postReview(app, "review-invalid-1", cookie);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "invalid_model_response" });
  });

  it("未配置模型时专业审查 503，不读取草稿", async () => {
    const deps = stubDeps();
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: null,
      aiTimeoutMs: 5_000,
      routerDeps: deps,
      research: stubResearch(),
    });
    const cookie = await login(app);
    const res = await postReview(app, "review-unconfigured-1", cookie);
    expect(res.status).toBe(503);
    expect(deps.service.requireSurveyAccess).not.toHaveBeenCalled();
  });

  it("错密码登录 401，拿不到会话 cookie", async () => {
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: null,
      aiTimeoutMs: 5_000,
      routerDeps: stubDeps(),
      research: stubResearch(),
    });
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("匿名 /api/research 401：研究数据面也在管理员闸之后，存储不被触达", async () => {
    const research = stubResearch();
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: null,
      aiTimeoutMs: 5_000,
      routerDeps: stubDeps(),
      research,
    });
    const res = await app.request(`/api/research/surveys/${SURVEY_ID}/datasets`);
    expect(res.status).toBe(401);
    expect(research.service.listDatasets).not.toHaveBeenCalled();
  });

  it("登录后研究数据面可达：数据集列表 200 并按管理员身份查询", async () => {
    const research = stubResearch();
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: null,
      aiTimeoutMs: 5_000,
      routerDeps: stubDeps(),
      research,
    });
    const cookie = await login(app);
    const res = await app.request(`/api/research/surveys/${SURVEY_ID}/datasets`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
    expect(research.service.listDatasets).toHaveBeenCalledWith("standalone-admin", SURVEY_ID);
  });
});
