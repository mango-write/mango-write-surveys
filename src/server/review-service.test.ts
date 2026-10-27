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
    record: (findings = [finding("f1"), finding("f2")]) =>
      service.recordReview(userId, surveyId, {
        operationId: "operation-1",
        baseDraftVersion: 1,
        summary: "两条建议",
        findings,
      }),
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
    survey.draftVersion = 2;

    await expect(service.applyReviewFinding(userId, surveyId, "f1", 2)).rejects.toMatchObject({
      code: "review_stale",
    });
    expect(survey.draftJson).toEqual(makeDefinition());
    expect(review()?.findingsJson).toHaveLength(2);
  });

  it("没有自动操作的条目不能应用，但可忽略", async () => {
    const { service, survey, record, review } = setup();
    await record([finding("manual", false)]);

    await expect(service.applyReviewFinding(userId, surveyId, "manual", 1)).rejects.toMatchObject({
      code: "review_not_applicable",
    });
    expect(survey.draftJson).toEqual(makeDefinition());
    expect(review()?.findingsJson).toHaveLength(1);

    const detail = await service.dismissReviewFinding(userId, surveyId, "manual");
    expect(detail.review).toBeNull();
  });
});
