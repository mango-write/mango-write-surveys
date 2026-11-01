import { describe, expect, it, vi } from "vitest";

import type { SurveyDefinition } from "../core/index.js";
import type { SurveysPorts } from "../ports.js";
import { createPretestService, PRETEST_ANSWER_TTL_MS, PRETEST_LINK_TTL_MS, type PretestStoragePort } from "./pretest.js";

const surveyId = "00000000-0000-4000-8000-000000000001";
const token = "a".repeat(43);
const now = new Date("2026-10-28T00:00:00Z");
const definition: SurveyDefinition = {
  version: 1, title: "试填", description: "", consent: "",
  questions: [{ id: "q1", type: "text", title: "问题", required: true }],
  pages: [{ id: "p1", title: "第一页", questionIds: ["q1"] }],
  researchDesign: { researchQuestion: "内部研究问题", population: "", recruitment: "", constructs: [], analysisPlan: "", assumptions: [], pendingDecisions: [] },
};

function setup() {
  const record = { id: "p1", surveyId, definition, draftVersion: 2, contentFingerprint: "a".repeat(64), expiresAt: new Date(now.getTime() + PRETEST_LINK_TTL_MS) };
  const ports = {
    auth: {
      resolveResourceAccess: vi.fn(async () => ({ canRead: true, canWrite: true, canDelete: true })),
      isCollectionAllowed: vi.fn(async () => true),
    },
    storage: {
      findById: vi.fn(async () => ({ id: surveyId, draftVersion: 2, draftJson: definition })),
      findMediaBinding: vi.fn(async () => null),
    },
    media: { get: vi.fn(async () => null) },
  } as unknown as SurveysPorts;
  const storage = {
    create: vi.fn(async (_input: Parameters<PretestStoragePort["create"]>[0]) => record),
    findByTokenHash: vi.fn(async (_hash: string) => record),
    list: vi.fn<PretestStoragePort["list"]>(async (_surveyId: string) => []),
    submit: vi.fn(async (_input: Parameters<PretestStoragePort["submit"]>[0]) => ({ id: "submission-1", completedAt: now })),
  } satisfies PretestStoragePort;
  return { service: createPretestService(ports, storage), ports, storage, record };
}

describe("独立试填", () => {
  it("仅作者可为当前版本创建七天有效的链接，凭证只以哈希交给存储", async () => {
    const { service, storage } = setup();
    const created = await service.create("author", surveyId, 2, now);
    expect(created.token).toHaveLength(43);
    expect(storage.create).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 2, expiresAt: new Date(now.getTime() + PRETEST_LINK_TTL_MS),
    }));
    expect(storage.create.mock.calls[0]![0].tokenHash).not.toContain(created.token);
    await expect(service.create("author", surveyId, 1, now)).rejects.toMatchObject({ code: "version_conflict" });
  });

  it("匿名读取只返回快照公开内容；过期和撤销采集资格均不可访问", async () => {
    const { service, ports, record } = setup();
    const result = await service.read(token, now);
    expect(result.definition).not.toHaveProperty("researchDesign");
    expect(result.answerRetentionDays).toBe(30);
    await expect(service.read(token, record.expiresAt)).rejects.toMatchObject({ code: "not_found" });
    vi.mocked(ports.auth.isCollectionAllowed).mockResolvedValue(false);
    await expect(service.read(token, now)).rejects.toMatchObject({ code: "not_found" });
  });

  it("试填图片不能使用正式发布的匿名图片地址，只能用试填凭证读取快照引用", async () => {
    const { service, ports, record } = setup();
    const fileId = "00000000-0000-4000-8000-000000000001";
    record.definition = {
      ...definition,
      questions: [{ id: "q1", type: "image_single", title: "选项", required: false, options: [{ id: "o1", label: "图片", imageFileId: fileId }] }],
    };
    vi.mocked(ports.storage.findMediaBinding).mockResolvedValue({ fileSha256: "sha" });
    vi.mocked(ports.media.get).mockResolvedValue({ buffer: Buffer.from("image"), mime: "image/png" });
    const result = await service.read(token, now);
    const question = result.definition.questions[0]!;
    expect(question.type).toBe("image_single");
    if (question.type !== "image_single") throw new Error("wrong question type");
    expect(question.options[0]).not.toHaveProperty("imageUrl");
    await expect(service.readAsset(token, fileId, now)).resolves.toMatchObject({ mime: "image/png" });
    await expect(service.readAsset(token, "00000000-0000-4000-8000-000000000002", now)).rejects.toMatchObject({ code: "not_found" });
    await expect(service.readAsset("wrong", fileId, now)).rejects.toMatchObject({ code: "not_found" });
  });

  it("校验答卷与题目反馈，将答卷过期时间和反馈分别交给独立存储", async () => {
    const { service, storage } = setup();
    const input = { submissionToken: "b".repeat(43), consent: true, answers: { q1: "回答" }, feedback: [{ questionId: "q1", aspect: "comprehension", note: "题意不清" }] };
    await expect(service.submit(token, input, now)).resolves.toMatchObject({ id: "submission-1" });
    expect(storage.submit).toHaveBeenCalledWith(expect.objectContaining({
      answers: input.answers, feedback: input.feedback,
      answerExpiresAt: new Date(now.getTime() + PRETEST_ANSWER_TTL_MS),
    }));
    await expect(service.submit(token, { ...input, answers: {} }, now)).rejects.toMatchObject({ code: "invalid_answers" });
    await expect(service.submit(token, { ...input, feedback: [{ ...input.feedback[0], questionId: "missing" }] }, now)).rejects.toMatchObject({ code: "invalid_feedback" });
    expect(storage.submit).toHaveBeenCalledTimes(1);
  });

  it("只汇总保留期内答卷，并区分未展示与展示后未作答", async () => {
    const { service, storage, record } = setup();
    const branched: SurveyDefinition = {
      ...definition,
      questions: [
        { id: "q1", type: "single", title: "是否", required: true, options: [{ id: "yes", label: "是" }, { id: "no", label: "否" }] },
        { id: "q2", type: "text", title: "原因", required: false, showIf: { questionId: "q1", op: "eq", value: "yes" } },
      ],
      pages: [{ id: "p1", title: "第一页", questionIds: ["q1", "q2"] }],
    };
    storage.list.mockResolvedValue([{ ...record, definition: branched, submissions: [
      { id: "s1", completedAt: now, answers: { q1: "yes" }, answerExpiresAt: new Date(now.getTime() + 1), feedback: [] },
      { id: "s2", completedAt: now, answers: { q1: "no" }, answerExpiresAt: new Date(now.getTime() + 1), feedback: [] },
      { id: "s3", completedAt: now, answers: { q1: "yes", q2: "私密答案" }, answerExpiresAt: now, feedback: [] },
    ] }]);
    const [result] = await service.list("author", surveyId, now);
    expect(result?.answerSummary).toEqual({ availableAnswers: 2, questions: [
      { questionId: "q1", displayed: 2, unanswered: 0 },
      { questionId: "q2", displayed: 1, unanswered: 1 },
    ] });
    expect(JSON.stringify(result)).not.toContain("私密答案");
  });
});
