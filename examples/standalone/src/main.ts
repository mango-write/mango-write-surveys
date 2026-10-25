// 独立站薄宿主（issue #223 §8）：Hono + @hono/node-server，自持 PostgreSQL、
// 媒体目录与单管理员会话；不连主站库。问卷业务全部来自 @mango-write/surveys。
// 应用装配（路由/鉴权/静态托管）在 app.ts 的 buildStandaloneApp。
import "dotenv/config";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import {
  createSurveysCollection,
  createSurveysMedia,
  createSurveysService,
  createResearchService,
} from "@mango-write/surveys/server";
import {
  createStandaloneSurveysPorts,
  initStandaloneSchema,
  standaloneAdminActor,
} from "@mango-write/surveys/adapters";

import { buildStandaloneApp } from "./app";
import { createOpenAiModel } from "./ai-model";

const DATABASE_URL = process.env.DATABASE_URL;
const MEDIA_DIR = process.env.MEDIA_DIR;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!DATABASE_URL || !MEDIA_DIR || !ADMIN_PASSWORD) {
  console.error("缺少环境变量：DATABASE_URL、MEDIA_DIR、ADMIN_PASSWORD 均必填（见 .env.example）");
  process.exit(1);
}
const PORT = Number(process.env.PORT ?? 3100);
// AI 建卷与审查共用 SURVEYS_AI_URL/_API_KEY/_MODEL；未配置时端点返回 503。
const aiModel =
  process.env.SURVEYS_AI_URL && process.env.SURVEYS_AI_API_KEY && process.env.SURVEYS_AI_MODEL
    ? createOpenAiModel({
        url: process.env.SURVEYS_AI_URL,
        apiKey: process.env.SURVEYS_AI_API_KEY,
        model: process.env.SURVEYS_AI_MODEL,
        timeoutMs: Number(process.env.SURVEYS_AI_TIMEOUT_MS ?? 60_000),
      })
    : null;
const aiTimeoutMs = Number(process.env.SURVEYS_AI_TIMEOUT_MS ?? 60_000);

const ports = createStandaloneSurveysPorts({ databaseUrl: DATABASE_URL, mediaDir: MEDIA_DIR });
const app = buildStandaloneApp({
  adminPassword: ADMIN_PASSWORD,
  aiModel,
  aiTimeoutMs,
  routerDeps: {
    service: createSurveysService(ports),
    collection: createSurveysCollection(ports),
    media: createSurveysMedia(ports),
    actorOf: () => standaloneAdminActor(),
  },
  research: {
    service: createResearchService(ports),
    actorOf: () => standaloneAdminActor(),
  },
  webDistDir: fileURLToPath(new URL("../web/dist", import.meta.url)),
});

await initStandaloneSchema(DATABASE_URL);
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`surveys standalone listening on http://localhost:${info.port}`);
});
