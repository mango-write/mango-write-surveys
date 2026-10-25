// 独立站应用层验收（recheck P1）：/api/ai/generate 与 surveys 管理面同一道
// 管理员会话闸——匿名请求必须在触达模型或存储之前 401；登录后的正常路径、
// 未配置 AI 的 503 与参数校验一并钉住。依赖全部注入桩，不落 PG、不发起网络。
import { describe, expect, it, vi } from "vitest";

import type { SurveyModelPort } from "@mango-write/surveys/ai";
import type { SurveysRouterDeps } from "@mango-write/surveys/server";

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
      requireSurveyAccess: vi.fn(),
      createSurvey: vi.fn(),
      updateSurvey: vi.fn(),
    },
    collection: { listCollections: vi.fn() },
    media: { uploadImage: vi.fn() },
    actorOf: vi.fn(() => ({ userId: "standalone-admin", space: { kind: "personal" } })),
  } as unknown as SurveysRouterDeps & {
    service: { createSurvey: ReturnType<typeof vi.fn>; updateSurvey: ReturnType<typeof vi.fn> };
  };
}

function stubModel() {
  return {
    complete: vi.fn(async () => ({ text: JSON.stringify(baseDefinition) })),
  } as unknown as SurveyModelPort & { complete: ReturnType<typeof vi.fn> };
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
    });
    const cookie = await login(app);
    const res = await app.request("/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ title: "", brief: "x".repeat(10), operationId: "op-too-short" }),
    });
    expect(res.status).toBe(400);
  });

  it("错密码登录 401，拿不到会话 cookie", async () => {
    const app = buildStandaloneApp({
      adminPassword: ADMIN_PASSWORD,
      aiModel: null,
      aiTimeoutMs: 5_000,
      routerDeps: stubDeps(),
    });
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});
