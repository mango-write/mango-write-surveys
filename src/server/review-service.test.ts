import { describe, expect, it } from "vitest";

import { makeDefinition } from "../core/test-fixtures.js";
import { buildSurveyReviewPlan, canonicalSurveyJson } from "../core/index.js";
import { sha256Hex } from "./serialize.js";
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
    record: (findings: SurveyReviewFinding[] = [finding("f1"), { ...finding("f2"), questionId: "q2", suggestedOps: [{ op: "update_question", questionId: "q2", patch: { title: "修改 f2" } }] }]) =>
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
  it("应用拆题建议时一并保存经核对的用途映射", async () => {
    const h = setup();
    const original = makeDefinition();
    original.researchDesign = { researchQuestion: "问题", population: "", recruitment: "", analysisPlan: "描述", assumptions: [], pendingDecisions: [],
      constructs: [{ id: "c1", label: "用途", definition: "用途", questionIds: ["q1"] }] };
    h.survey.draftJson = original;
    const nextDesign = { ...original.researchDesign, constructs: [{ ...original.researchDesign.constructs[0]!, questionIds: ["q1", "ai-q"] }] };
    await h.record([{ ...finding("split"), suggestedOps: [
      { op: "add_question", pageId: "p1", question: { id: "ai-q", type: "text", title: "补充问题", required: false } },
      { op: "set_meta", researchDesign: nextDesign },
    ] }]);
    const detail = await h.service.applyReviewFinding(userId, surveyId, "split", 1);
    expect(detail.definition.researchDesign?.constructs[0]?.questionIds).toEqual(["q1", "ai-q"]);
    expect(detail.definition.sourceRecords?.some((entry) => entry.questionId === "ai-q")).toBe(true);
  });
  it("应用建议新增题目时保存 AI 来源和原始快照", async () => {
    const h = setup();
    await h.record([{ ...finding("added"), suggestedOps: [{ op: "add_question", pageId: "p1", question: { id: "ai-q", type: "text", title: "补充问题", required: false } }] }]);
    const detail = await h.service.applyReviewFinding(userId, surveyId, "added", 1);
    const record = detail.definition.sourceRecords?.find((entry) => entry.questionId === "ai-q");
    expect(record?.sourceId).toBe("ai-generated-unverified");
    expect(record?.baselineQuestion).toBe(canonicalSurveyJson(detail.definition.questions.find((question) => question.id === "ai-q")));
  });
  it("旧诊断中对说明和同意条款的修改只作为人工待办", async () => {
    const h = setup();
    await h.record([{ ...finding("consent"), suggestedOps: [{ op: "set_meta", description: "补写同意文案", consent: "匿名且仅用于汇总" }] }]);
    const detail = await h.service.getSurveyDetail(userId, surveyId);
    expect(detail.review?.findings[0]?.suggestedOps).toBeUndefined();
    expect(detail.review?.findings[0]?.recommendation).toContain("实际研究用途、数据处理和参与条件");
  });
  it("旧诊断中新增跳题条件不得作为自动修订", async () => {
    const h = setup();
    await h.record([{ ...finding("routing"), suggestedOps: [{ op: "update_question", questionId: "q1", patch: { showIf: { questionId: "q2", op: "eq", value: "yes" } } }] }]);
    const detail = await h.service.getSurveyDetail(userId, surveyId);
    expect(detail.review?.findings[0]?.suggestedOps).toBeUndefined();
    await expect(h.service.applyReviewFinding(userId, surveyId, "routing", 1)).rejects.toMatchObject({ code: "review_not_applicable" });
  });
  it("读取旧报告时清除没有操作却声称已附上的回执", async () => {
    const h = setup();
    await h.record([{ ...finding("manual", false), recommendation: "请核对题目；我已附上可直接应用的修改。" }]);
    const detail = await h.service.getSurveyDetail(userId, surveyId);
    expect(detail.review?.findings[0]?.recommendation).toBe("请核对题目；");
  });
  it("旧客户端保存不认识来源字段时保留记录，并根据新题目重新判断状态", async () => {
    const h = setup();
    const original = makeDefinition();
    const sourceRecords = [{ sourceId: "sus-brooke-1996", questionId: "q1", language: "zh-CN", baselineQuestion: canonicalSurveyJson(original.questions[0]) }];
    h.survey.draftJson = { ...original, sourceRecords };
    const edited = makeDefinition();
    edited.questions[0]!.title = "编辑过的题目";
    const result = await h.service.updateSurvey(userId, surveyId, { expectedVersion: 1, definition: edited });
    expect(result.definition.sourceRecords).toEqual(sourceRecords);
    expect(result.definition.questions[0]!.title).toBe("编辑过的题目");
  });
  it("显式空来源记录恢复为无来源字段，区别于旧客户端省略字段", async () => {
    const h = setup();
    h.survey.draftJson = { ...makeDefinition(), sourceRecords: [{ sourceId: "ai-generated-unverified", questionId: "q1", language: "und", baselineQuestion: "{}" }] };
    const result = await h.service.updateSurvey(userId, surveyId, { expectedVersion: 1, definition: { ...makeDefinition(), sourceRecords: [] } });
    expect(result.definition).not.toHaveProperty("sourceRecords");
  });
  it("批量应用只推进一次版本并保留人工事项，重复请求不会再次写入", async () => {
    const h = setup();
    await h.record([finding("f1"), { ...finding("f2"), questionId: "q2", suggestedOps: [{ op: "update_question", questionId: "q2", patch: { title: "修改 f2" } }] }, finding("manual", false)]);
    const review = await h.service.getSurveyDetail(userId, surveyId);
    const candidateFingerprint = sha256Hex(canonicalSurveyJson(buildSurveyReviewPlan(review.definition, review.review!.findings).candidateDefinition!));
    const detail = await h.service.applyReviewPlan(userId, surveyId, { expectedVersion: 1, operationId: "operation-1", candidateFingerprint, findingIds: ["f1", "f2"] });
    expect(detail.draftVersion).toBe(2);
    expect(detail.definition.questions.find((q) => q.id === "q1")?.title).toBe("修改 f1");
    expect(detail.definition.questions.find((q) => q.id === "q2")?.title).toBe("修改 f2");
    expect(detail.review?.findings.map((f) => f.id)).toEqual(["manual"]);
    await expect(h.service.applyReviewPlan(userId, surveyId, { expectedVersion: 1, operationId: "operation-1", candidateFingerprint, findingIds: ["f1", "f2"] })).rejects.toMatchObject({ code: "version_conflict" });
    expect(h.survey.draftVersion).toBe(2);
  });

  it("报告替换、选择不匹配或操作冲突时不写入任何修改", async () => {
    const h = setup();
    await h.record();
    const candidateFingerprint = "a".repeat(64);
    for (const input of [
      { expectedVersion: 1, operationId: "operation-other", candidateFingerprint, findingIds: ["f1", "f2"] },
      { expectedVersion: 1, operationId: "operation-1", candidateFingerprint, findingIds: ["f1", "missing"] },
      { expectedVersion: 1, operationId: "operation-1", candidateFingerprint, findingIds: ["f1", "f2"] },
    ]) await expect(h.service.applyReviewPlan(userId, surveyId, input)).rejects.toMatchObject({ status: 409 });
    expect(h.survey.draftVersion).toBe(1);
    expect(h.review()).not.toBeNull();
    await h.record([finding("f1"), finding("f2")]);
    await expect(h.service.applyReviewPlan(userId, surveyId, { expectedVersion: 1, operationId: "operation-1", candidateFingerprint, findingIds: ["f1", "f2"] })).rejects.toMatchObject({ code: "review_plan_conflict" });
    expect(h.survey.draftVersion).toBe(1);
  });

  it("批次中任一条对基线没有实际作用时整批不应用", async () => {
    const h = setup();
    const original = makeDefinition();
    await h.record([finding("f1"), { ...finding("f2"), questionId: "q2", suggestedOps: [{ op: "update_question", questionId: "q2", patch: { title: original.questions[1]!.title } }] }]);
    const detail = await h.service.getSurveyDetail(userId, surveyId);
    const candidateFingerprint = sha256Hex(canonicalSurveyJson(buildSurveyReviewPlan(detail.definition, detail.review!.findings).candidateDefinition!));
    await expect(h.service.applyReviewPlan(userId, surveyId, { expectedVersion: 1, operationId: "operation-1", candidateFingerprint, findingIds: ["f1", "f2"] })).rejects.toMatchObject({ code: "review_plan_conflict" });
    expect(h.survey.draftVersion).toBe(1);
  });
  it("旧诊断中的未确认占位内容只展示为人工待办，不能经旧请求应用", async () => {
    const { service, record, survey } = setup();
    await record([{ ...finding("f1"), suggestedOps: [{ op: "update_question", questionId: "q1", patch: { title: "待补充" } }] }]);
    const restored = await service.getSurveyDetail(userId, surveyId);
    expect(restored.review?.findings[0]?.suggestedOps).toBeUndefined();
    expect(restored.review?.findings[0]?.recommendation).toContain("先确认");
    await expect(service.applyReviewFinding(userId, surveyId, "f1", 1)).rejects.toMatchObject({ code: "review_not_applicable" });
    expect(survey.draftVersion).toBe(1);
  });

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
    expect(detail.review?.findings[0]?.suggestedOps).toBeDefined();
    expect(survey.draftVersion).toBe(2);
    expect(review()?.baseDraftVersion).toBe(2);
  });

  it("先应用一条后，冲突建议不能覆盖同一字段且仍保留为待处理事项", async () => {
    const { service, record } = setup();
    await record([finding("f1"), finding("f2")]);

    const detail = await service.applyReviewFinding(userId, surveyId, "f1", 1);
    expect(detail.review?.findings[0]).toMatchObject({
      id: "f2",
      recommendation: "其他建议已修改相关内容，请重新检查问卷后再处理此建议。",
    });
    expect(detail.review?.findings[0]?.suggestedOps).toBeUndefined();
    await expect(service.applyReviewFinding(userId, surveyId, "f2", 2)).rejects.toMatchObject({
      code: "review_not_applicable",
    });
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
