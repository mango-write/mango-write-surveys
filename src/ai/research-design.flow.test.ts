import { describe, expect, it, vi } from "vitest";

import type {
  SurveyRecord,
  SurveysLock,
  SurveysPorts,
  SurveysStoragePort,
} from "../ports.js";
import type { SurveyDefinition } from "../core/index.js";
import { applySurveyOps } from "../core/index.js";
import { createSurveysService } from "../server/service.js";
import { createSurveyAiTools } from "./tools.js";
import { surveyDeliveryFromResult } from "./delivery.js";

const researchDesign = {
  researchQuestion: "博士生如何使用 AI 辅助文献综述？",
  population: "在读博士生",
  recruitment: "院系邮件列表",
  purpose: "describe" as const,
  timeBudgetMinutes: 10,
  constructs: [{ id: "c1", label: "使用频率", definition: "近三个月使用频率", questionIds: ["q1"] }],
  analysisPlan: "描述统计与按年级分组",
  assumptions: [],
  pendingDecisions: ["是否需要按学科分层"],
};

function memoryStorage() {
  const rows = new Map<string, SurveyRecord>();
  let seq = 0;
  const unimplemented = () => {
    throw new Error("unimplemented_port");
  };
  const storage = {
    async findById(id: string, opts?: { excludeDeleted?: boolean }) {
      const row = rows.get(id);
      if (!row) return null;
      if (opts?.excludeDeleted && row.deletedAt) return null;
      return row;
    },
    async findBySlug() {
      return null;
    },
    async listByOwner(userId: string, teamId: string | null) {
      return [...rows.values()].filter((row) => row.userId === userId && row.teamId === teamId);
    },
    async create(input: { userId: string; teamId: string | null; title: string; definition: SurveyDefinition; id?: string }) {
      seq += 1;
      const id = input.id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
      if (!rows.has(id)) {
        rows.set(id, {
          id,
          userId: input.userId,
          teamId: input.teamId,
          title: input.title,
          slug: `slug-${String(seq).padStart(16, "0")}`,
          status: "draft",
          currentRevisionId: null,
          draftVersion: 1,
          draftJson: input.definition,
          completedCount: 0,
          responseLimit: 1000,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          deletedAt: null,
        });
      }
      return { id };
    },
    async countStarted() {
      return 0;
    },
    async countFinished() {
      return 0;
    },
    async listRevisions() {
      return [];
    },
    async withSurveyLock<T>(id: string, fn: (tx: SurveysLock) => Promise<T>) {
      return fn({
        async survey() {
          return rows.get(id) ?? null;
        },
        async updateSurvey(patch: Parameters<SurveysLock["updateSurvey"]>[0]) {
          const row = rows.get(id);
          if (!row) throw new Error("missing_row");
          if (patch.title !== undefined) row.title = patch.title;
          if (patch.draftJson !== undefined) row.draftJson = patch.draftJson;
          if (patch.draftVersion !== undefined) row.draftVersion = patch.draftVersion;
          if (patch.status !== undefined) row.status = patch.status;
          if (patch.currentRevisionId !== undefined) row.currentRevisionId = patch.currentRevisionId;
          if (patch.deletedAt !== undefined) row.deletedAt = patch.deletedAt;
        },
        findRevisionById: unimplemented,
        latestRevisionNumber: unimplemented,
        insertRevision: unimplemented,
        boundFileIds: unimplemented,
        countFinishedResponses: unimplemented,
        findResponseByTokenHash: unimplemented,
        createResponse: unimplemented,
        finishResponse: unimplemented,
        deleteMediaBindings: unimplemented,
      });
    },
    findRevisionOfSurvey: unimplemented,
    listFinishedResponses: unimplemented,
    findMediaBinding: unimplemented,
    createMediaBinding: unimplemented,
    findPublishedAssetSha: unimplemented,
  } as unknown as SurveysStoragePort;
  return { storage, rows };
}

function setup() {
  const { storage, rows } = memoryStorage();
  const ports = {
    auth: {
      resolveResourceAccess: vi.fn(async () => ({ canRead: true, canWrite: true, canDelete: true })),
      resolveSpaceAccess: vi.fn(async () => ({ canRead: true, canWrite: true })),
      isCollectionAllowed: vi.fn(async () => true),
      runInResourceSpace: vi.fn(async (_teamId: string | null, fn: () => Promise<unknown>) => fn()),
    },
    storage,
    media: {
      put: vi.fn(async () => ({ sha256: "a".repeat(64), bytes: 1, mime: "image/png" })),
      get: vi.fn(async () => null),
      collectAfterRelease: vi.fn(async () => undefined),
    },
  } as unknown as SurveysPorts;
  const service = createSurveysService(ports);
  const tools = createSurveyAiTools(service);
  const actor = { userId: "author", space: { kind: "personal" as const } };
  return { tools, service, actor, rows };
}

const definitionWithDesign = {
  version: 1 as const,
  title: "AI 辅助写作调查",
  description: "",
  consent: "本次调查匿名，仅用于研究。",
  questions: [
    { id: "q1", type: "nps" as const, title: "你推荐同门使用 AI 写作工具吗？", required: true },
    { id: "q2", type: "text" as const, title: "最近一次使用是什么场景？", required: false },
  ],
  pages: [{ id: "p1", title: "第 1 页", questionIds: ["q1", "q2"] }],
  researchDesign: { ...researchDesign, constructs: [{ ...researchDesign.constructs[0]!, questionIds: ["q1"] }] },
};

describe("研究设计与诊断 — 真实 service facade 往返", () => {
  it("survey_create 落库 researchDesign，survey_read 完整读回，survey_review 在真实定义上登记", async () => {
    const { tools, actor, rows } = setup();

    const created = await tools.surveyCreate.run(
      { title: definitionWithDesign.title, definition: definitionWithDesign },
      { actor, scopeSurveyId: null, operationId: "op-create-1" },
    );
    expect(created.ok).toBe(true);
    const surveyId = String(created.surveyId);
    // 落库的是完整定义（含设计），不是被 schema 剥掉的壳。
    const stored = rows.get(surveyId)!;
    expect((stored.draftJson as typeof definitionWithDesign).researchDesign.researchQuestion).toBe(
      researchDesign.researchQuestion,
    );
    expect(stored.draftVersion).toBe(2);

    const read = await tools.surveyRead.run({}, { actor, scopeSurveyId: surveyId, operationId: "op-read-1" });
    expect(read.ok).toBe(true);
    expect(read.draftVersion).toBe(2);
    const readDefinition = read.definition as typeof definitionWithDesign;
    expect(readDefinition.researchDesign).toEqual(definitionWithDesign.researchDesign);
    expect(read.researchDesignHint).toBeUndefined();
    expect(read.issues).toBeUndefined();
    expect((read.standards as { checks: unknown[] }).checks.length).toBeGreaterThan(0);

    const review = await tools.surveyReview.run(
      {
        baseDraftVersion: 2,
        summary: "结构可用；开放题缺少追问",
        findings: [
          {
            id: "f1",
            checkId: "coverage.construct_dimensions",
            questionId: "q2",
            title: "维度覆盖不足",
            severity: "major",
            reason: "设计登记了一个维度，但只有一题在测它",
            recommendation: "补一题使用场景的选择题",
            suggestedOps: [
              {
                op: "add_question",
                pageId: "p1",
                question: {
                  id: "q3",
                  type: "single",
                  title: "最常使用的场景",
                  required: false,
                  options: [
                    { id: "a", label: "文献综述" },
                    { id: "b", label: "讨论与回复" },
                  ],
                },
              },
            ],
          },
        ],
      },
      { actor, scopeSurveyId: surveyId, operationId: "op-review-1" },
    );
    expect(review.ok).toBe(true);
    // 诊断不落库：草稿版本不变，建议留给用户确认。
    expect(rows.get(surveyId)!.draftVersion).toBe(2);
    expect(surveyDeliveryFromResult("survey_review", review)).toMatchObject({
      type: "survey_review",
      surveyId,
      baseDraftVersion: 2,
    });
  });

  it("题数不符在建卷前拒绝：不产生行，同一 operationId 修正后重试只建一份", async () => {
    const { tools, actor, rows } = setup();
    expect(definitionWithDesign.questions).toHaveLength(2);

    const rejected = await tools.surveyCreate.run(
      { title: definitionWithDesign.title, expectedQuestionCount: 3, definition: definitionWithDesign },
      { actor, scopeSurveyId: null, operationId: "op-count-1" },
    );
    expect(rejected.ok).toBeUndefined();
    expect(String(rejected.error)).toContain("题数不符");
    expect(rows.size).toBe(0);

    const retried = await tools.surveyCreate.run(
      { title: definitionWithDesign.title, expectedQuestionCount: 2, definition: definitionWithDesign },
      { actor, scopeSurveyId: null, operationId: "op-count-1" },
    );
    expect(retried.ok).toBe(true);
    expect(rows.size).toBe(1);
    expect(rows.get(String(retried.surveyId))!.draftVersion).toBe(2);
  });

  it("set_meta 清除后落库：设计中不再有 researchDesign，定义仍可读", async () => {
    const { tools, service, actor, rows } = setup();
    const created = await tools.surveyCreate.run(
      { title: definitionWithDesign.title, definition: definitionWithDesign },
      { actor, scopeSurveyId: null, operationId: "op-create-2" },
    );
    const surveyId = String(created.surveyId);

    const edit = await tools.surveyEdit.run(
      { baseDraftVersion: 2, ops: [{ op: "set_meta", researchDesign: null }], summary: "清除研究设计" },
      { actor, scopeSurveyId: surveyId, operationId: "op-edit-1" },
    );
    expect(edit.ok).toBe(true);
    // host-applied：工具本身不写库，画布把 appliedOps 应用到本地草稿后保存。
    expect(rows.get(surveyId)!.draftVersion).toBe(2);
    const appliedOps = (edit.appliedOps as Parameters<typeof applySurveyOps>[1]);
    const cleared = applySurveyOps(definitionWithDesign, appliedOps).definition;
    expect(cleared).not.toHaveProperty("researchDesign");

    await service.updateSurvey("author", surveyId, { expectedVersion: 2, definition: cleared });
    expect(rows.get(surveyId)!.draftVersion).toBe(3);
    expect((rows.get(surveyId)!.draftJson as { researchDesign?: unknown }).researchDesign).toBeUndefined();

    const read = await tools.surveyRead.run({}, { actor, scopeSurveyId: surveyId, operationId: "op-read-2" });
    expect(read.draftVersion).toBe(3);
    expect(read.definition).not.toHaveProperty("researchDesign");
    expect(String(read.researchDesignHint)).toContain("researchDesign");
  });
});
