// 独立站应用装配（issue #223 §8）：会话鉴权、问卷路由、AI 建卷与静态托管
// 在此组装；端口装配（PG/媒体目录）与监听在 main.ts。buildStandaloneApp 的
// 依赖可注入，app.test.ts 据此验证「鉴权先于模型与存储」。
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import type { SurveyModelPort } from "@mango-write/surveys/ai";
import {
  generateSurveyDefinition,
  idempotentSurveyId,
} from "@mango-write/surveys/ai";
import type { SurveysRouterDeps } from "@mango-write/surveys/server";
import {
  createSurveysManageRoutes,
  createSurveysPublicRoutes,
} from "@mango-write/surveys/server";

export interface StandaloneAppConfig {
  adminPassword: string;
  /** AI 建卷模型；null 时 /api/ai/generate 一律 503。 */
  aiModel: SurveyModelPort | null;
  aiTimeoutMs: number;
  routerDeps: SurveysRouterDeps;
  /** web/dist 绝对路径；缺省或不存在时跳过静态托管（API 仍可用）。 */
  webDistDir?: string;
}

export function buildStandaloneApp(config: StandaloneAppConfig): Hono {
  const SESSION_COOKIE = "surveys_admin_session";
  const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  // 哈希定长后再比对（timingSafeEqual 要求等长输入），也避免闭包里的窄化丢失。
  const ADMIN_PASSWORD_HASH = createHash("sha256").update(config.adminPassword).digest();
  // 内存会话表：单进程足够；多副本部署需换共享存储（Redis 等）。
  const sessions = new Map<string, number>();

  const pruneSessions = () => {
    const now = Date.now();
    for (const [token, expiresAt] of sessions) if (expiresAt <= now) sessions.delete(token);
  };

  const passwordMatches = (input: string): boolean =>
    timingSafeEqual(createHash("sha256").update(input).digest(), ADMIN_PASSWORD_HASH);

  const requireAdmin: MiddlewareHandler = async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const expiresAt = token ? sessions.get(token) : undefined;
    if (!expiresAt || expiresAt <= Date.now()) {
      if (expiresAt) sessions.delete(token as string);
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };

  const app = new Hono();

  app.post("/api/admin/login", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const password = (body as { password?: unknown } | null)?.password;
    pruneSessions();
    if (typeof password !== "string" || !passwordMatches(password))
      return c.json({ error: "unauthorized" }, 401);
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
    return c.json({ ok: true });
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.use("/api/surveys", requireAdmin);
  app.use("/api/surveys/*", requireAdmin);
  app.route("/api/surveys", createSurveysManageRoutes(config.routerDeps));
  app.route("/api/survey-public", createSurveysPublicRoutes(config.routerDeps));

  // AI 建卷（issue #223 §6 验收）：SURVEYS_AI_URL/_API_KEY/_MODEL 配齐才启用；
  // 未配置返回 503，前端面板如实显示。建卷带 operationId 幂等——同一次提交的
  // 网络重试不会建出两份问卷。鉴权与 surveys 管理面同款 exact + wildcard 两条：
  // Hono 的 app.use 不带通配只匹配字面路径，/api/ai/generate 必须由通配那条盖住。
  app.use("/api/ai", requireAdmin);
  app.use("/api/ai/*", requireAdmin);
  app.post("/api/ai/generate", async (c) => {
    if (!config.aiModel) return c.json({ error: "ai_not_configured" }, 503);
    const body = (await c.req.json().catch(() => null)) as {
      title?: unknown;
      brief?: unknown;
      operationId?: unknown;
    } | null;
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const brief = typeof body?.brief === "string" ? body.brief.trim() : "";
    const operationId = typeof body?.operationId === "string" ? body.operationId : "";
    if (!title || !brief || operationId.length < 6) {
      return c.json({ error: "bad_request" }, 400);
    }
    const result = await generateSurveyDefinition(
      config.aiModel,
      { title, brief },
      { signal: c.req.raw.signal, timeoutMs: config.aiTimeoutMs },
    );
    if (!result.ok) return c.json({ error: "generation_failed", detail: result.error }, 400);
    const actor = config.routerDeps.actorOf(c);
    try {
      const created = await config.routerDeps.service.createSurvey(actor, {
        title,
        idempotentSurveyId: idempotentSurveyId(actor.userId, operationId),
      });
      // 幂等重试落在已存草稿的问卷（版本 >1）时跳过重复写草稿。
      if (created.draftVersion === 1) {
        await config.routerDeps.service.updateSurvey(actor.userId, created.id, {
          expectedVersion: 1,
          definition: result.definition,
        });
      }
      return c.json({ ok: true, surveyId: created.id });
    } catch (err) {
      console.error(err);
      return c.json({ error: "create_failed" }, 500);
    }
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  // 前端静态托管（web/ 子应用，vite build 产物）：命中文件直接回；未命中且非
  // API 的 GET 回 index.html（SPA fallback，/s/:slug、/surveys/:id 深链可达）。
  // root 用绝对路径：serveStatic 不受启动 cwd 影响。
  const webDist = config.webDistDir;
  if (webDist && existsSync(webDist + "/index.html")) {
    app.use("*", serveStatic({ root: webDist }));
    app.get("*", (c) => {
      const path = c.req.path;
      // 带扩展名的未命中（favicon.ico、过期 hash chunk）回 404，不用 200 HTML
      // 冒充成功；只有无扩展名的导航路径才落 SPA fallback。
      if (path.startsWith("/api/") || /\.[\w]+$/.test(path)) {
        return c.json({ error: "not_found" }, 404);
      }
      return c.html(readFileSync(webDist + "/index.html", "utf8"));
    });
  }
  return app;
}
