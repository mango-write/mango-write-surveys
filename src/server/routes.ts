// surveys 路由工厂：管理面（宿主挂认证后）与匿名采集面（自带状态/凭证/限流/
// 载荷闸）。公开面的边界全在这里，不靠前端：no-store/noindex、IP 限流、JSON
// 前 bodyLimit。
// 本文件是包自带的 **Hono adapter**：actorOf 收 Hono Context、返回 Hono 实例。
// 领域层（ports/service/collection/media 与 storage/auth/media adapter）不依赖
// 任何 HTTP 框架——非 Hono 宿主绕过本文件，直接装配 service 工厂。
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { SurveysActor } from "../ports.js";
import {
  CreateSurveyInputSchema,
  SetSurveyStatusInputSchema,
  StartSurveyInputSchema,
  SubmitSurveyInputSchema,
  UpdateSurveyInputSchema,
} from "../contracts/index.js";

import type { SurveysCollection } from "./collection.js";
import { SurveyError } from "./errors.js";
import { InvalidUploadError } from "./upload-validation.js";
import {
  SURVEY_MANAGE_BODY_MAX_BYTES,
  SURVEY_MEDIA_BODY_MAX_BYTES,
  SURVEY_MEDIA_MAX_BYTES,
  SURVEY_START_BODY_MAX_BYTES,
  SURVEY_START_RATE_PER_MINUTE,
  SURVEY_SUBMIT_BODY_MAX_BYTES,
  SURVEY_SUBMIT_RATE_PER_MINUTE,
} from "./limits.js";
import type { SurveysMedia } from "./media.js";
import { surveyRateLimit } from "./rate-limit.js";
import type { SurveysService } from "./service.js";

export interface SurveysRouterDeps {
  service: SurveysService;
  collection: SurveysCollection;
  media: SurveysMedia;
  /** 宿主认证后的主体与归属空间（身份永不来自请求体）。 */
  actorOf: (c: Context) => SurveysActor;
}

type RouteHandler = (c: Context) => Promise<Response>;

function handle(fn: RouteHandler): RouteHandler {
  return async (c) => {
    try {
      return await fn(c);
    } catch (err) {
      if (err instanceof SurveyError) {
        return c.json(
          {
            error: err.code,
            message: err.message,
            ...(err.issues ? { issues: err.issues } : {}),
          },
          err.status as ContentfulStatusCode,
        );
      }
      // 宿主特有语义错误（如主站 WrongTenantError）原样穿透给宿主 onError。
      throw err;
    }
  };
}

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new SurveyError("bad_request", 400, "请求体不是合法 JSON");
  }
}

/** 路由模式未声明时 param 是 string|undefined；缺参数按不存在处理。 */
function pathParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new SurveyError("not_found", 404);
  return value;
}

const UUID_PARAM_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidParam(c: Context, name: string): string {
  const value = pathParam(c, name);
  // 先校验再查询，避免 PostgreSQL 22P02。
  if (!UUID_PARAM_RE.test(value)) throw new SurveyError("not_found", 404);
  return value;
}

/** 媒体字节响应：content-type 用存储的权威 mime；nosniff + SVG CSP。
 *  缓存策略由调用方给（认证侧 private / 公开侧 immutable）。 */
function mediaResponse(
  bytes: { buffer: Buffer; mime: string },
  cacheControl: string,
): Response {
  const inline = bytes.mime.startsWith("image/") || bytes.mime === "application/pdf";
  return new Response(new Uint8Array(bytes.buffer), {
    headers: {
      "content-type": bytes.mime,
      "x-content-type-options": "nosniff",
      ...(inline ? {} : { "content-disposition": "attachment" }),
      ...(bytes.mime === "image/svg+xml"
        ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" }
        : {}),
      "cache-control": cacheControl,
    },
  });
}

/** 自主仓 lib/download.ts vendored：RFC 5987 双 filename 的附件头。 */
function asciiFilename(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]+/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const basename = normalized.replace(/\.[^.]+$/, "");
  return /[a-zA-Z0-9]/.test(basename) ? normalized : fallback;
}

function buildContentDisposition(
  filename: string,
  options?: { disposition?: "attachment" | "inline"; fallback?: string },
): string {
  const disposition = options?.disposition ?? "attachment";
  const fallback = asciiFilename(filename, options?.fallback ?? "download");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createSurveysManageRoutes(deps: SurveysRouterDeps): Hono {
  const { service, media, actorOf } = deps;
  const routes = new Hono();

  // 管理面 bodyLimit 只管 JSON 写入；媒体上传走自己的 6MB 闸（multipart 外壳比
  // 单文件 5MB 上限厚），否则全局 640KiB 先把图片拒掉。
  routes.use("*", async (c, next) => {
    if (c.req.method === "POST" && /\/media$/.test(c.req.path)) return next();
    return bodyLimit({
      maxSize: SURVEY_MANAGE_BODY_MAX_BYTES,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    })(c, next);
  });

  routes.get(
    "/",
    handle(async (c) =>
      c.json({ items: await service.listSurveys(actorOf(c)) }),
    ),
  );

  routes.post(
    "/",
    handle(async (c) => {
      const parsed = CreateSurveyInputSchema.safeParse(await jsonBody(c));
      if (!parsed.success)
        throw new SurveyError("invalid_input", 400, "输入不合法");
      return c.json(await service.createSurvey(actorOf(c), parsed.data));
    }),
  );

  routes.get(
    "/:id",
    handle(async (c) =>
      c.json(await service.getSurveyDetail(actorOf(c).userId, pathParam(c, "id"))),
    ),
  );

  routes.patch(
    "/:id",
    handle(async (c) => {
      const parsed = UpdateSurveyInputSchema.safeParse(await jsonBody(c));
      if (!parsed.success)
        throw new SurveyError("invalid_input", 400, "输入不合法");
      return c.json(
        await service.updateSurvey(actorOf(c).userId, pathParam(c, "id"), parsed.data),
      );
    }),
  );

  routes.post(
    "/:id/publish",
    handle(async (c) =>
      c.json(await service.publishSurvey(actorOf(c).userId, pathParam(c, "id"))),
    ),
  );

  routes.post(
    "/:id/status",
    handle(async (c) => {
      const parsed = SetSurveyStatusInputSchema.safeParse(await jsonBody(c));
      if (!parsed.success)
        throw new SurveyError("invalid_input", 400, "输入不合法");
      return c.json(
        await service.setSurveyStatus(
          actorOf(c).userId,
          pathParam(c, "id"),
          parsed.data,
        ),
      );
    }),
  );

  routes.delete(
    "/:id",
    handle(async (c) => {
      await service.deleteSurvey(actorOf(c).userId, pathParam(c, "id"));
      return c.json({ ok: true });
    }),
  );

  routes.get(
    "/:id/responses",
    handle(async (c) =>
      c.json({
        items: await service.listResponses(
          actorOf(c).userId,
          pathParam(c, "id"),
          c.req.query("revisionId"),
        ),
      }),
    ),
  );

  routes.get(
    "/:id/export",
    handle(async (c) => {
      const { filename, csv } = await service.exportResponsesCsv(
        actorOf(c).userId,
        pathParam(c, "id"),
        c.req.query("revisionId"),
      );
      c.header("Content-Type", "text/csv; charset=utf-8");
      c.header(
        "Content-Disposition",
        buildContentDisposition(filename, { fallback: "survey.csv" }),
      );
      c.header("Cache-Control", "no-store");
      return c.body(csv);
    }),
  );

  routes.get(
    "/:id/codebook",
    handle(async (c) =>
      c.json(
        await service.surveyCodebook(
          actorOf(c).userId,
          pathParam(c, "id"),
          c.req.query("revisionId"),
        ),
      ),
    ),
  );

  // ── 题目选项图媒体 ────────────────────────────────────────────────────────
  // POST /media (multipart/form-data, field "file")——宿主把本工厂挂到
  // /api/surveys/:id 之下。
  routes.post(
    "/:id/media",
    bodyLimit({
      maxSize: SURVEY_MEDIA_BODY_MAX_BYTES,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
    handle(async (c) => {
      const surveyId = uuidParam(c, "id");
      let body: Awaited<ReturnType<typeof c.req.parseBody>>;
      try {
        body = await c.req.parseBody();
      } catch {
        throw new SurveyError("bad_request", 400, "expected multipart form");
      }
      const file = body["file"];
      if (!(file instanceof File))
        throw new SurveyError("bad_request", 400, "missing file field");
      if (file.size === 0)
        throw new SurveyError("bad_request", 400, "empty file");
      if (file.size > SURVEY_MEDIA_MAX_BYTES)
        throw new SurveyError("payload_too_large", 413, "max 5MB");
      const buffer = Buffer.from(await file.arrayBuffer());
      try {
        const record = await media.uploadSurveyMedia(actorOf(c).userId, surveyId, {
          buffer,
          mime: file.type || "application/octet-stream",
          filename: file.name || "image",
        });
        return c.json(
          { ...record, createdAt: record.createdAt.toISOString() },
          201,
        );
      } catch (err) {
        if (err instanceof InvalidUploadError) {
          if (err.reason === "too_large")
            throw new SurveyError("payload_too_large", 413, "max 5MB");
          throw new SurveyError(
            "unsupported_media_type",
            415,
            "不支持的文件类型，请上传 PNG / JPEG / GIF / WebP / SVG 图片。",
          );
        }
        throw err;
      }
    }),
  );

  // GET /:id/media/:fileId — 草稿期渲染（编辑器与预览），作者认证。
  routes.get(
    "/:id/media/:fileId",
    handle(async (c) => {
      const bytes = await media.getSurveyMediaBytes(
        actorOf(c).userId,
        uuidParam(c, "id"),
        uuidParam(c, "fileId"),
      );
      if (!bytes) throw new SurveyError("not_found", 404);
      return mediaResponse(bytes, "private, max-age=31536000, immutable");
    }),
  );

  return routes;
}

export function createSurveysPublicRoutes(deps: SurveysRouterDeps): Hono {
  const { collection, media } = deps;
  const routes = new Hono();

  // 受访者链接不属于可发现内容：不进搜索索引，也不许任何缓存层留副本。
  // 公开资产（/assets/:fileId）例外：字节按内容寻址且不可变，由 handler 落
  // immutable 缓存头——这里跳过，别把 no-store 盖回去。
  routes.use("*", async (c, next) => {
    await next();
    if (/\/assets\//.test(c.req.path)) return;
    c.header("Cache-Control", "no-store, max-age=0");
    c.header("Pragma", "no-cache");
    c.header("X-Robots-Tag", "noindex, nofollow");
  });

  routes.use(
    "/:slug/start",
    surveyRateLimit({
      name: "survey-start",
      windowMs: 60_000,
      max: SURVEY_START_RATE_PER_MINUTE,
      methods: ["POST"],
    }),
  );
  routes.use(
    "/:slug/responses",
    surveyRateLimit({
      name: "survey-submit",
      windowMs: 60_000,
      max: SURVEY_SUBMIT_RATE_PER_MINUTE,
      methods: ["POST"],
    }),
  );

  routes.use(
    "/:slug/start",
    bodyLimit({
      maxSize: SURVEY_START_BODY_MAX_BYTES,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
  );
  routes.use(
    "/:slug/responses",
    bodyLimit({
      maxSize: SURVEY_SUBMIT_BODY_MAX_BYTES,
      onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
  );

  routes.get(
    "/:slug",
    handle(async (c) => c.json(await collection.getPublicSurvey(pathParam(c, "slug")))),
  );

  routes.post(
    "/:slug/start",
    handle(async (c) => {
      const parsed = StartSurveyInputSchema.safeParse(await jsonBody(c));
      if (!parsed.success)
        throw new SurveyError("invalid_input", 400, "输入不合法");
      return c.json(await collection.startSurvey(pathParam(c, "slug"), parsed.data));
    }),
  );

  routes.post(
    "/:slug/responses",
    handle(async (c) => {
      const parsed = SubmitSurveyInputSchema.safeParse(await jsonBody(c));
      if (!parsed.success)
        throw new SurveyError("invalid_input", 400, "输入不合法");
      return c.json(await collection.submitSurvey(pathParam(c, "slug"), parsed.data));
    }),
  );

  // GET /assets/:fileId — 选项图的匿名公开面（无身份）。放行条件在
  // media.getPublicSurveyAsset：有绑定行且被任一已发布快照引用。
  routes.get(
    "/assets/:fileId",
    handle(async (c) => {
      const bytes = await media.getPublicSurveyAsset(uuidParam(c, "fileId"));
      if (!bytes) throw new SurveyError("not_found", 404);
      // 字节按 sha256 寻址、内容永不变化：公开面唯一允许长缓存的资源。
      return mediaResponse(bytes, "public, max-age=31536000, immutable");
    }),
  );

  return routes;
}
