import { describe, expect, it, vi } from "vitest";
import type { SurveysActor, SurveysPorts, SurveyRecord } from "../ports.js";
import { makeDefinition } from "../core/test-fixtures.js";
import { createSurveysService } from "./service.js";

const surveyId = "00000000-0000-4000-8000-000000000001";
const author: SurveysActor = { userId: "author", space: { kind: "personal" } };

function makeRecord(overrides: Partial<SurveyRecord> = {}): SurveyRecord {
  return {
    id: surveyId,
    userId: "author",
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
    ...overrides,
  };
}

function setup() {
  const definition = makeDefinition();
  const resolveSpaceAccess = vi.fn(async () => ({ canRead: true, canWrite: true }));
  const resolveResourceAccess = vi.fn(async () => ({
    canRead: true,
    canWrite: true,
    canDelete: true,
  }));
  const listByOwner = vi.fn(async () => [makeRecord()]);
  const create = vi.fn(async () => ({ id: surveyId }));
  const findById = vi.fn(async (): Promise<SurveyRecord | null> =>
    makeRecord({ draftJson: definition }),
  );
  const ports = {
    auth: { resolveSpaceAccess, resolveResourceAccess },
    storage: { listByOwner, create, findById, countStarted: async () => 0, listRevisions: async () => [] },
  } as unknown as SurveysPorts;
  return { service: createSurveysService(ports), resolveSpaceAccess, resolveResourceAccess, listByOwner, create, findById };
}

describe("listSurveys 空间策略", () => {
  it("策略拒绝时抛 not_found 且不触达存储", async () => {
    const { service, resolveSpaceAccess, listByOwner } = setup();
    resolveSpaceAccess.mockResolvedValue({ canRead: false, canWrite: false });
    await expect(service.listSurveys(author)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(listByOwner).not.toHaveBeenCalled();
  });

  it("个人空间允许时正常列出，策略恰好判定一次", async () => {
    const { service, resolveSpaceAccess, listByOwner } = setup();
    const rows = await service.listSurveys(author);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(surveyId);
    expect(resolveSpaceAccess).toHaveBeenCalledTimes(1);
    expect(resolveSpaceAccess).toHaveBeenCalledWith("author", { kind: "personal" });
    expect(listByOwner).toHaveBeenCalledWith("author", null);
  });

  it("team 空间把 teamId 透传给归属查询", async () => {
    const { service, resolveSpaceAccess, listByOwner } = setup();
    const actor: SurveysActor = { userId: "author", space: { kind: "team", teamId: "team-1" } };
    await service.listSurveys(actor);
    expect(resolveSpaceAccess).toHaveBeenCalledWith("author", actor.space);
    expect(listByOwner).toHaveBeenCalledWith("author", "team-1");
  });
});

describe("createSurvey 空间策略", () => {
  it("拒读抛 not_found 且不建行", async () => {
    const { service, resolveSpaceAccess, create } = setup();
    resolveSpaceAccess.mockResolvedValue({ canRead: false, canWrite: false });
    await expect(service.createSurvey(author, { title: "新问卷" })).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("拒写抛 forbidden 且不建行", async () => {
    const { service, resolveSpaceAccess, create } = setup();
    resolveSpaceAccess.mockResolvedValue({ canRead: true, canWrite: false });
    await expect(service.createSurvey(author, { title: "新问卷" })).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("允许时创建成功，策略恰好判定一次", async () => {
    const { service, resolveSpaceAccess, create } = setup();
    const detail = await service.createSurvey(author, { title: "新问卷" });
    expect(detail.id).toBe(surveyId);
    expect(resolveSpaceAccess).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "author", teamId: null, title: "新问卷" }),
    );
  });
});

describe("createSurvey 幂等（AI operationId 派生）", () => {
  it("同 id 已有本身份问卷：直接复用，不重复建行", async () => {
    const { service, create } = setup();
    const detail = await service.createSurvey(author, {
      title: "新问卷",
      idempotentSurveyId: surveyId,
    });
    expect(detail.id).toBe(surveyId);
    expect(create).not.toHaveBeenCalled();
  });

  it("id 未占用：建行时带上 id", async () => {
    const { service, create, findById } = setup();
    // 首查（幂等探测）未命中，随后 getSurveyDetail 的读取命中既有桩。
    findById.mockResolvedValueOnce(null);
    await service.createSurvey(author, { title: "新问卷", idempotentSurveyId: "00000000-0000-4000-8000-0000000000ff" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "00000000-0000-4000-8000-0000000000ff" }),
    );
  });
});
