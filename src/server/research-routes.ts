import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
  CreateResearchRunInputSchema,
  ResearchDatasetImportInputSchema,
} from "../contracts/index.js";
import type { SurveysActor } from "../ports.js";
import {
  renderResearchReportHtml,
  renderResearchResultCsv,
  researchRunJson,
} from "../research/report.js";

import { SurveyError } from "./errors.js";
import type { ResearchService } from "./research-service.js";

export interface ResearchRouterDeps {
  service: ResearchService;
  actorOf: (c: Context) => SurveysActor;
}

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new SurveyError("bad_request", 400, "请求体不是合法 JSON");
  }
}

function param(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new SurveyError("not_found", 404);
  return value;
}

export function createResearchRoutes(deps: ResearchRouterDeps): Hono {
  const routes = new Hono();
  routes.use("*", bodyLimit({
    maxSize: 7 * 1024 * 1024,
    onError: (c) => c.json({ error: "payload_too_large", message: "请求体超过 7 MiB 上限" }, 413),
  }));
  routes.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "private, no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
  });
  const handle = (fn: (c: Context) => Promise<Response>) => async (c: Context) => {
    try {
      return await fn(c);
    } catch (error) {
      if (!(error instanceof SurveyError)) throw error;
      return c.json(
        { error: error.code, message: error.message, ...(error.issues ? { issues: error.issues } : {}) },
        error.status as ContentfulStatusCode,
      );
    }
  };

  routes.post("/datasets", handle(async (c) => {
    const parsed = ResearchDatasetImportInputSchema.safeParse(await jsonBody(c));
    if (!parsed.success)
      throw new SurveyError("invalid_input", 400, parsed.error.issues[0]?.message ?? "输入不合法");
    return c.json(await deps.service.importDataset(deps.actorOf(c).userId, parsed.data), 201);
  }));

  routes.get("/surveys/:surveyId/datasets", handle(async (c) =>
    c.json({ items: await deps.service.listDatasets(deps.actorOf(c).userId, param(c, "surveyId")) }),
  ));

  routes.get("/surveys/:surveyId/datasets/:datasetId", handle(async (c) =>
    c.json(await deps.service.getDataset(deps.actorOf(c).userId, param(c, "surveyId"), param(c, "datasetId"))),
  ));

  routes.post("/surveys/:surveyId/runs", handle(async (c) => {
    const parsed = CreateResearchRunInputSchema.safeParse(await jsonBody(c));
    if (!parsed.success)
      throw new SurveyError("invalid_input", 400, parsed.error.issues[0]?.message ?? "输入不合法");
    return c.json(await deps.service.createRun(deps.actorOf(c).userId, param(c, "surveyId"), parsed.data), 201);
  }));

  routes.get("/surveys/:surveyId/runs", handle(async (c) =>
    c.json({ items: await deps.service.listRuns(deps.actorOf(c).userId, param(c, "surveyId")) }),
  ));

  routes.get("/surveys/:surveyId/runs/:runId", handle(async (c) =>
    c.json(await deps.service.getRun(deps.actorOf(c).userId, param(c, "surveyId"), param(c, "runId"))),
  ));

  routes.get("/surveys/:surveyId/runs/:runId/report.html", handle(async (c) => {
    const data = await deps.service.getRunExport(deps.actorOf(c).userId, param(c, "surveyId"), param(c, "runId"));
    c.header("Content-Type", "text/html; charset=utf-8");
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'");
    c.header("X-Content-Type-Options", "nosniff");
    return c.body(renderResearchReportHtml(data));
  }));

  routes.get("/surveys/:surveyId/runs/:runId/result.json", handle(async (c) => {
    const data = await deps.service.getRunExport(deps.actorOf(c).userId, param(c, "surveyId"), param(c, "runId"));
    return c.json(researchRunJson(data));
  }));

  routes.get("/surveys/:surveyId/runs/:runId/result.csv", handle(async (c) => {
    const data = await deps.service.getRunExport(deps.actorOf(c).userId, param(c, "surveyId"), param(c, "runId"));
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="research-${data.run.id}.csv"`);
    return c.body(renderResearchResultCsv(data));
  }));

  return routes;
}
