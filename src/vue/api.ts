// 问卷 API client：全部请求经宿主 transport（认证/租户头/baseId 由宿主持有）。
// 错误面统一为 SurveysApiError；公开作答面同源反代，凭证策略由宿主 transport
// 按 /api/survey-public 前缀自理（主站：omit + no-store）。
import type {
  CreateResearchRunInput,
  PublicSurvey,
  ResearchDatasetDetail,
  ResearchDatasetImportInput,
  ResearchDatasetSummary,
  ResearchRunDetail,
  ResearchRunSummary,
  SurveyAnswers,
  SurveyCodebook,
  SurveyDefinition,
  SurveyDetail,
  SurveyMedia,
  SurveyReceipt,
  SurveyResponseView,
  SurveySession,
  SurveySummary,
} from "../contracts/index.js";
import { SurveysApiError, useSurveysHost, type SurveysWebHost } from "./host.js";

/** 对 transport 的薄封装：解析 JSON、非 2xx 归一为 SurveysApiError。 */
async function call<T>(
  host: SurveysWebHost,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  try {
    return await host.transport.request<T>(path, init);
  } catch (err) {
    if (err instanceof SurveysApiError) throw err;
    const status = (err as { status?: number }).status;
    const detail = (err as { detail?: unknown }).detail;
    if (typeof status === "number") throw new SurveysApiError(status, "request_failed", detail);
    throw new SurveysApiError(0, "network_error", err);
  }
}

export function createSurveysApi(host: SurveysWebHost) {
  return {
    list: () => call<{ items: SurveySummary[] }>(host, "/api/surveys"),
    create: (title: string) =>
      call<SurveyDetail>(host, "/api/surveys", { method: "POST", body: { title } }),
    get: (id: string) => call<SurveyDetail>(host, `/api/surveys/${id}`),
    save: (
      id: string,
      expectedVersion: number,
      definition: SurveyDefinition,
      responseLimit?: number,
    ) =>
      call<SurveyDetail>(host, `/api/surveys/${id}`, {
        method: "PATCH",
        body: {
          expectedVersion,
          definition,
          ...(responseLimit !== undefined ? { responseLimit } : {}),
        },
      }),
    publish: (id: string) =>
      call<SurveyDetail>(host, `/api/surveys/${id}/publish`, { method: "POST" }),
    status: (id: string, status: "published" | "paused" | "closed") =>
      call<SurveyDetail>(host, `/api/surveys/${id}/status`, {
        method: "POST",
        body: { status },
      }),
    remove: (id: string) =>
      call<{ ok: boolean }>(host, `/api/surveys/${id}`, { method: "DELETE" }),
    /** 选项图上传（multipart，作者认证）：字节嗅探白名单仅图片、单文件 ≤5MB。 */
    uploadMedia: (id: string, file: File) => {
      const body = new FormData();
      body.append("file", file);
      return call<SurveyMedia>(host, `/api/surveys/${id}/media`, {
        method: "POST",
        body,
      });
    },
    /** 草稿期选项图地址（编辑器与预览的 <img> 直连，作者认证）。 */
    mediaUrl: (id: string, fileId: string) => `/api/surveys/${id}/media/${fileId}`,
    responses: (surveyId: string, revisionId?: string | null) =>
      call<{ items: SurveyResponseView[] }>(
        host,
        `/api/surveys/${surveyId}/responses${revisionId ? `?revisionId=${revisionId}` : ""}`,
      ),
    codebook: (surveyId: string, revisionId?: string | null) =>
      call<SurveyCodebook>(
        host,
        `/api/surveys/${surveyId}/codebook${revisionId ? `?revisionId=${revisionId}` : ""}`,
      ),
    exportUrl: (surveyId: string, revisionId?: string | null) =>
      `/api/surveys/${surveyId}/export${revisionId ? `?revisionId=${revisionId}` : ""}`,
    async downloadExport(
      surveyId: string,
      filename: string,
      revisionId?: string | null,
    ): Promise<void> {
      if (!host.transport.download) throw new SurveysApiError(0, "download_unsupported", null);
      await host.transport.download(this.exportUrl(surveyId, revisionId), filename);
    },
    // ── 研究分析（固定运行）：权威契约见 ../contracts（SurveyResearchRecipe 等），
    // 面板组件只经这组方法访问 /api/research/*，不在组件里拼路径。
    research: {
      createDataset: (input: ResearchDatasetImportInput) =>
        call<ResearchDatasetSummary>(host, "/api/research/datasets", {
          method: "POST",
          body: input,
        }),
      listDatasets: (surveyId: string) =>
        call<{ items: ResearchDatasetSummary[] }>(
          host,
          `/api/research/surveys/${surveyId}/datasets`,
        ),
      getDataset: (surveyId: string, datasetId: string) =>
        call<ResearchDatasetDetail>(
          host,
          `/api/research/surveys/${surveyId}/datasets/${datasetId}`,
        ),
      listRuns: (surveyId: string) =>
        call<{ items: ResearchRunSummary[] }>(
          host,
          `/api/research/surveys/${surveyId}/runs`,
        ),
      createRun: (surveyId: string, input: CreateResearchRunInput) =>
        call<ResearchRunSummary>(host, `/api/research/surveys/${surveyId}/runs`, {
          method: "POST",
          body: input,
        }),
      getRun: (surveyId: string, runId: string) =>
        call<ResearchRunDetail>(
          host,
          `/api/research/surveys/${surveyId}/runs/${runId}`,
        ),
      runFileUrl: (
        surveyId: string,
        runId: string,
        file: "report.html" | "result.json" | "result.csv",
      ) => `/api/research/surveys/${surveyId}/runs/${runId}/${file}`,
      downloadRunFile: async (
        surveyId: string,
        runId: string,
        file: "result.json" | "result.csv",
        filename: string,
      ): Promise<void> => {
        if (!host.transport.download) throw new SurveysApiError(0, "download_unsupported", null);
        await host.transport.download(
          `/api/research/surveys/${surveyId}/runs/${runId}/${file}`,
          filename,
        );
      },
    },
  };
}

export type SurveysApi = ReturnType<typeof createSurveysApi>;

export function createPublicSurveysApi(host: SurveysWebHost) {
  const path = (slug: string, suffix: string) =>
    `/api/survey-public/${encodeURIComponent(slug)}${suffix}`;
  return {
    get: (slug: string) => call<PublicSurvey>(host, path(slug, "")),
    start: (slug: string, resumeToken?: string) =>
      call<SurveySession>(host, path(slug, "/start"), {
        method: "POST",
        body: { consent: true, ...(resumeToken ? { resumeToken } : {}) },
      }),
    submit: (
      slug: string,
      sessionToken: string,
      answers: SurveyAnswers,
      honeypot: string,
    ) =>
      call<SurveyReceipt>(host, path(slug, "/responses"), {
        method: "POST",
        body: { sessionToken, answers, honeypot },
      }),
  };
}

export type PublicSurveysApi = ReturnType<typeof createPublicSurveysApi>;

/** 组件内取 API 的统一入口：测试经 createTestHost({transport: spy}) 拦截。 */
export function useSurveysApi(): SurveysApi {
  return createSurveysApi(useSurveysHost());
}

export function usePublicSurveysApi(): PublicSurveysApi {
  return createPublicSurveysApi(useSurveysHost());
}
