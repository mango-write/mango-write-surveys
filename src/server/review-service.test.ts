import { describe, expect, it } from "vitest";

import { makeDefinition } from "../core/test-fixtures.js";
import type { SurveyReviewFinding } from "../contracts/index.js";
import type {
  SurveyRecord,
  SurveyReviewRecord,
  SurveysLock,
  SurveysPorts,
} from "../ports.js";
import { createSurveysService } from "./service.js";

const surveyId = "00000000-0000-4000-8000-000000000001";
const userId = "author";

function finding(id: string, withOps = true): SurveyReviewFinding {
  return {
    id,
    questionId: "q1",
    title: `发现 ${id}`,
    severity: "major",
    reason: "题干需要修改",
    recommendation: "修改题干",
    ...(withOps
      ? { suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: `修改 ${id}` } }] }
      : {}),
  };
}

function setup() {
  const survey: SurveyRecord = {
    id: surveyId,
    userId,
    teamId: null,
    title: "测试问卷",
    slug: "slug-0000000000000001",
    status: "draft",
    currentRevisionId: null,
    draftVersion: 1,
    draftJson: makeDefinition(),
    completedCount: 0,
    responseLimit: 1000,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  };
  let review: SurveyReviewRecord | null = null;
  const lock: SurveysLock = {
    survey: async () => survey,
    updateSurvey: async (patch) => {
      Object.assign(survey, patch);
    },
    review: async () => review,
    upsertReview: async (input) => {
      review = {
        id: "review-1",
        surveyId,
        operationId: input.operationId,
        baseDraftVersion: input.baseDraftVersion,
        summary: input.summary,
        findingsJson: input.findings,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
    },
    updateReview: async (_id, patch) => {
      if (!review) throw new Error("missing_review");
      review = {
        ...review,
        findingsJson: patch.findings,
        ...(patch.baseDraftVersion !== undefined
          ? { baseDraftVersion: patch.baseDraftVersion }
          : {}),
      };
    },
    deleteReview: async () => {
      review = null;
    },
    findRevisionById: async () => null,
    latestRevisionNumber: async () => 0,
    insertRevision: async () => ({ id: "revision-1" }),
    boundFileIds: async () => [],
    countFinishedResponses: async () => 0,
    findResponseByTokenHash: async () => null,
    createResponse: async () => {},
    finishResponse: async () => {
      throw new Error("not_implemented");
    },
    deleteMediaBindings: async () => [],
  };
  const ports = {
    auth: {
      resolveResourceAccess: async () => ({ canRead: true, canWrite: true, canDelete: true }),
    },
    storage: {
      findById: async () => survey,
      findReview: async () => review,
      countStarted: async () => 0,
      listRevisions: async () => [],
      withSurveyLock: async <T>(_id: string, fn: (tx: SurveysLock) => Promise<T>) => fn(lock),
    },
  } as unknown as SurveysPorts;
  const service = createSurveysService(ports);
  return {
    service,
    survey,
    review: () => review,
    setReview: (next: SurveyReviewRecord | null) => {
      review = next;
    },
    record: (findings = [finding("f1"), finding("f2")]) =>
      service.recordReview(userId, surveyId, {
        operationId: "operation-1",
        baseDraftVersion: 1,
        summary: "两条建议",
        findings,
      }),
  };
}

/** 保存试填反馈后的草稿形态：版本推进，题目内容未动（可能合成全空设计基底）。 */
function withPretest(recordedAt: string) {
  return {
    ...makeDefinition(),
    researchDesign: {
      researchQuestion: "",
      population: "",
      recruitment: "",
      purpose: "describe" as const,
      timeBudgetMinutes: 5,
      constructs: [],
      analysisPlan: "",
      assumptions: [],
      pendingDecisions: [],
      pretest: { participantCount: 3, notes: "两人反馈题干歧义", recordedAt },
    },
  };
}

describe("SurveysService 诊断记录", () => {
  it("报告经详情恢复；逐条忽略，最后一条后清空", async () => {
    const { service, record, review } = setup();
    await record();
    const restored = await service.getSurveyDetail(userId, surveyId);
    expect(restored.review?.findings.map((item) => item.id)).toEqual(["f1", "f2"]);

    const remaining = await service.dismissReviewFinding(userId, surveyId, "f1");
    expect(remaining.review?.findings.map((item) => item.id)).toEqual(["f2"]);
    expect(review()?.baseDraftVersion).toBe(1);

    const empty = await service.dismissReviewFinding(userId, surveyId, "f2");
    expect(empty.review).toBeNull();
    expect(review()).toBeNull();
  });

  it("应用在同一版本推进中改题并移除建议，其余建议继续有效", async () => {
    const { service, survey, record, review } = setup();
    await record();
    const detail = await service.applyReviewFinding(userId, surveyId, "f1", 1);

    expect(detail.draftVersion).toBe(2);
    expect(detail.definition.questions[0]).toMatchObject({ title: "修改 f1" });
    expect(detail.review).toMatchObject({ baseDraftVersion: 2 });
    expect(detail.review?.findings.map((item) => item.id)).toEqual(["f2"]);
    expect(survey.draftVersion).toBe(2);
    expect(review()?.baseDraftVersion).toBe(2);
  });

  it("过期基线拒绝应用，题目和报告保持原样", async () => {
    const { service, survey, record, review } = setup();
    await record();
    // 基线过期 = 内容真的变了（仅版本推进而内容未变走指纹口径，不算过期）。
    survey.draftVersion = 2;
    survey.draftJson = { ...makeDefinition(), title: "基线后改了标题" };

    await expect(service.applyReviewFinding(userId, surveyId, "f1", 2)).rejects.toMatchObject({
      code: "review_stale",
    });
    expect(survey.draftJson).toEqual({ ...makeDefinition(), title: "基线后改了标题" });
    const payload = review()?.findingsJson as { findings: unknown[] };
    expect(payload.findings).toHaveLength(2);
  });

  it("登记时服务端盖章内容指纹；详情恢复携带同一指纹", async () => {
    const { service, record, review } = setup();
    const delivery = await record();
    expect(delivery.baseContentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const payload = review()?.findingsJson as { baseContentFingerprint?: string };
    expect(payload.baseContentFingerprint).toBe(delivery.baseContentFingerprint);

    const restored = await service.getSurveyDetail(userId, surveyId);
    expect(restored.review?.baseContentFingerprint).toBe(delivery.baseContentFingerprint);
  });

  it("仅补试填记录：版本推进、内容指纹未变，建议仍可应用", async () => {
    const { service, survey, record } = setup();
    await record();
    // 记录试填的草稿形态：可能带全空研究设计基底（无设计草稿合成），剥掉
    // pretest 后归一化为原定义，指纹不变。
    survey.draftVersion = 2;
    survey.draftJson = withPretest("2026-01-02T00:00:00.000Z");

    const detail = await service.applyReviewFinding(userId, surveyId, "f1", 2);
    expect(detail.draftVersion).toBe(3);
    expect(detail.definition.questions[0]).toMatchObject({ title: "修改 f1" });
  });

  it("内容真的变了：即使有指纹也拒绝应用", async () => {
    const { service, survey, record } = setup();
    await record();
    survey.draftVersion = 2;
    survey.draftJson = { ...makeDefinition(), title: "真的改了标题" };

    await expect(service.applyReviewFinding(userId, surveyId, "f1", 2)).rejects.toMatchObject({
      code: "review_stale",
    });
  });

  it("旧记录无指纹字段：回退版本号对比，版本不一致拒绝", async () => {
    const { service, survey, record, review, setReview } = setup();
    await record();
    // 旧格式：findings_json 是裸数组、无指纹。
    setReview({
      ...(review() as SurveyReviewRecord),
      findingsJson: [finding("f1"), finding("f2")],
    });
    survey.draftVersion = 2;

    await expect(service.applyReviewFinding(userId, surveyId, "f1", 2)).rejects.toMatchObject({
      code: "review_stale",
    });
    expect(survey.draftVersion).toBe(2);
  });

  it("应用后剩余建议的基线推进到应用后的内容指纹", async () => {
    const { service, record, review } = setup();
    await record();
    const detail = await service.applyReviewFinding(userId, surveyId, "f1", 1);

    expect(detail.review?.baseDraftVersion).toBe(2);
    expect(detail.review?.baseContentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const payload = review()?.findingsJson as { baseContentFingerprint?: string };
    expect(payload.baseContentFingerprint).toBe(detail.review?.baseContentFingerprint);
  });

  it("没有自动操作的条目不能应用，但可忽略", async () => {
    const { service, survey, record, review } = setup();
    await record([finding("manual", false)]);

    await expect(service.applyReviewFinding(userId, surveyId, "manual", 1)).rejects.toMatchObject({
      code: "review_not_applicable",
    });
    expect(survey.draftJson).toEqual(makeDefinition());
    const payload = review()?.findingsJson as { findings: unknown[] };
    expect(payload.findings).toHaveLength(1);

    const detail = await service.dismissReviewFinding(userId, surveyId, "manual");
    expect(detail.review).toBeNull();
  });
});
