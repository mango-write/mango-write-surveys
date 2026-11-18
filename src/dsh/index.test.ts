import { beforeEach, describe, expect, it, vi } from "vitest";

import { SurveyError } from "../server/errors.js";
import type { SurveysService } from "../server/service.js";
import {
  DshSurveyToolError,
  SURVEYS_DSH_MANIFEST,
  toDshSurveyTools,
} from "./index.js";

const SURVEY_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR = { userId: "user-1", space: { kind: "personal" as const } };

const baseDefinition = {
  version: 1 as const,
  title: "测试问卷",
  description: "",
  consent: "",
  questions: [
    {
      id: "q1",
      type: "single" as const,
      title: "单选题",
      required: true,
      options: [
        { id: "a", label: "选项 A" },
        { id: "b", label: "选项 B" },
      ],
    },
  ],
  pages: [{ id: "p1", title: "第一页", questionIds: ["q1"] }],
  researchDesign: {
    researchQuestion: "了解情况",
    population: "",
    recruitment: "",
    constructs: [{ id: "c1", label: "情况", definition: "情况", questionIds: ["q1"] }],
    analysisPlan: "描述统计",
    assumptions: [],
    pendingDecisions: [],
  },
};

describe("@mango-write/surveys/dsh 兼容适配层", () => {
  let service: SurveysService & {
    requireSurveyAccess: ReturnType<typeof vi.fn>;
    createSurvey: ReturnType<typeof vi.fn>;
    updateSurvey: ReturnType<typeof vi.fn>;
    recordReview: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    service = {
      requireSurveyAccess: vi.fn().mockResolvedValue({
        id: SURVEY_ID,
        title: "测试问卷",
        status: "draft",
        draftVersion: 3,
        draftJson: baseDefinition,
      }),
      createSurvey: vi.fn(),
      updateSurvey: vi.fn().mockImplementation(async (_uid: string, _id: string, input: { expectedVersion: number; definition: unknown }) => ({
        id: SURVEY_ID,
        draftVersion: input.expectedVersion + 1,
        definition: input.definition,
      })),
      recordReview: vi.fn(),
    } as never;
  });

  it("SURVEYS_DSH_MANIFEST 对齐 DshPackageManifest v1 结构且零外部运行时依赖", () => {
    expect(SURVEYS_DSH_MANIFEST).toMatchObject({
      name: "@mango-write/surveys",
      engines: { dsh: expect.stringContaining("0.2.2") },
      dsh: {
        manifestVersion: 1,
        bundle: { patch: "cordis.patch.yml" },
        client: { platform: "web", external: ["@mango-write/surveys/mount"] },
      },
    });
  });

  it("toDshSurveyTools 投影四件套工具（含 output.presentationMeta 与并发分类）", async () => {
    const tools = toDshSurveyTools(service);
    expect(tools.map((tool) => tool.name)).toEqual([
      "survey_read",
      "survey_edit",
      "survey_create",
      "survey_review",
    ]);
    expect(tools[0]!.isConcurrencySafe({})).toBe(true);
    expect(tools[1]!.isConcurrencySafe({})).toBe(false);

    const editTool = tools.find((tool) => tool.name === "survey_edit")!;
    const result = await editTool.execute(
      {
        baseDraftVersion: 3,
        ops: [{ op: "update_question", questionId: "q1", patch: { title: "dsh 更新题干" } }],
        summary: "修改题干",
      },
      { actor: ACTOR, scopeSurveyId: SURVEY_ID, callId: "dsh-call-1" },
    );
    expect(result).toMatchObject({
      ok: true,
      surveyId: SURVEY_ID,
      draftVersion: 4,
    });
    const meta = editTool.output.presentationMeta({}, result);
    expect(meta).toMatchObject({
      type: "survey_edit",
      surveyId: SURVEY_ID,
      baseDraftVersion: 3,
      draftVersion: 4,
    });
    expect(editTool.output.render({}, result)).toEqual([
      { type: "text", text: expect.stringContaining('"draftVersion":4') },
    ]);
  });

  it("AbortSignal 已取消时在派发前即抛稳定大写错误码 ABORTED，不触碰存储层", async () => {
    const tools = toDshSurveyTools(service);
    const editTool = tools.find((tool) => tool.name === "survey_edit")!;
    const controller = new AbortController();
    controller.abort();

    await expect(
      editTool.execute(
        { baseDraftVersion: 3, ops: [{ op: "set_meta", title: "x" }], summary: "s" },
        { actor: ACTOR, scopeSurveyId: SURVEY_ID, signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      name: "DshSurveyToolError",
      code: "ABORTED",
      info: { code: "ABORTED" },
    });
    expect(service.requireSurveyAccess).not.toHaveBeenCalled();
    expect(service.updateSurvey).not.toHaveBeenCalled();
  });

  it("业务拒绝统一映射为稳定大写错误码（SCOPE_REQUIRED / STALE_READ / FORBIDDEN / VALIDATION_FAILED）", async () => {
    const tools = toDshSurveyTools(service);
    const editTool = tools.find((tool) => tool.name === "survey_edit")!;

    await expect(
      editTool.execute(
        { baseDraftVersion: 3, ops: [{ op: "set_meta", title: "x" }], summary: "s" },
        { actor: ACTOR, scopeSurveyId: null },
      ),
    ).rejects.toMatchObject({ code: "SCOPE_REQUIRED" });

    await expect(
      editTool.execute(
        { baseDraftVersion: 2, ops: [{ op: "set_meta", title: "x" }], summary: "s" },
        { actor: ACTOR, scopeSurveyId: SURVEY_ID },
      ),
    ).rejects.toMatchObject({
      code: "STALE_READ",
      details: { currentDraftVersion: 3 },
    });

    await expect(
      editTool.execute(
        { baseDraftVersion: 3, ops: [], summary: "s" },
        { actor: ACTOR, scopeSurveyId: SURVEY_ID },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    service.requireSurveyAccess.mockRejectedValueOnce(new SurveyError("forbidden", 403));
    const err = await editTool
      .execute(
        { baseDraftVersion: 3, ops: [{ op: "set_meta", title: "x" }], summary: "s" },
        { actor: ACTOR, scopeSurveyId: SURVEY_ID },
      )
      .catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(DshSurveyToolError);
    expect((err as DshSurveyToolError).code).toBe("FORBIDDEN");
  });
});
