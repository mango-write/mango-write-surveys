import { beforeEach, expect, it, vi } from "vitest";
import { createSurveysPublicRoutes, type SurveysRouterDeps } from "./routes.js";
import { resetSurveyRateLimitForTests } from "./rate-limit.js";

beforeEach(() => resetSurveyRateLimitForTests());

it("图片请求不会耗尽同一网络的试填提交额度", async () => {
  const submit = vi.fn(async () => ({ id: "submission" }));
  const routes = createSurveysPublicRoutes({
    pretest: { readAsset: vi.fn(async () => ({ buffer: Buffer.from("image"), mime: "image/png" })), submit },
  } as unknown as SurveysRouterDeps);
  const post = (path: string, body: unknown) => routes.request(path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  for (let i = 0; i < 121; i++) {
    const response = await post("/pretests/assets/00000000-0000-4000-8000-000000000001", { token: "test" });
    expect(response.status).toBe(200);
  }
  expect((await post("/pretests/responses", { token: "test", submission: {} })).status).toBe(200);
  expect(submit).toHaveBeenCalledOnce();
});
