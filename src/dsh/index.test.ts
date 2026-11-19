import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DSH_PACKAGE_JSON = createRequire(import.meta.url).resolve("@deepseek-ai/dsh/package.json");

interface DshAppBootRuntime {
  loadProfileDirectory(
    binName: string,
    dir: string,
    installAnchor: string,
  ): {
    layers: Array<{ packageName: string; patchPaths: readonly string[]; patches: unknown[] }>;
    skippedBundles: Array<{ packageName: string; reason: string }>;
  };
  composeEntries(
    layers: readonly unknown[][],
    warn?: (message: string) => void,
  ): Array<Record<string, unknown>>;
}

interface DshToolsRuntime {
  assertSupportedJsonSchema(schema: unknown): void;
  validateJsonSchemaValue(schema: unknown, value: unknown): string[];
}

async function lockedDshAppBoot(): Promise<DshAppBootRuntime> {
  const requireDsh = createRequire(DSH_PACKAGE_JSON);
  const modulePath = requireDsh.resolve("@deepseek-ai/dsh-app-boot");
  return import(pathToFileURL(modulePath).href) as Promise<DshAppBootRuntime>;
}

async function lockedDshTools(): Promise<DshToolsRuntime> {
  const requireDsh = createRequire(DSH_PACKAGE_JSON);
  const basePackageJson = requireDsh.resolve("@deepseek-ai/dsh-base/package.json");
  const modulePath = createRequire(basePackageJson).resolve("@deepseek-ai/dsh-tools");
  return import(pathToFileURL(modulePath).href) as Promise<DshToolsRuntime>;
}

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

  async function executeSuccessfulReceipts() {
    const tools = toDshSurveyTools(service);
    const byName = (name: string) => tools.find((tool) => tool.name === name)!;
    service.createSurvey.mockResolvedValue({ id: SURVEY_ID, draftVersion: 1 });
    const context = { actor: ACTOR, scopeSurveyId: SURVEY_ID, callId: "dsh-contract-1" };
    const receipts = {
      survey_read: await byName("survey_read").execute({}, context),
      survey_edit: await byName("survey_edit").execute({
        baseDraftVersion: 3,
        ops: [{ op: "update_question", questionId: "q1", patch: { title: "dsh 更新题干" } }],
        summary: "修改题干",
      }, context),
      survey_create: await byName("survey_create").execute(
        { title: "测试问卷", definition: baseDefinition },
        { ...context, scopeSurveyId: null },
      ),
      survey_review: await byName("survey_review").execute(
        { baseDraftVersion: 3, summary: "诊断已登记", findings: [] },
        context,
      ),
    };
    return { tools, receipts };
  }

  it("SURVEYS_DSH_MANIFEST 与真实包根 DshPackageManifest v1 完全一致", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    expect(SURVEYS_DSH_MANIFEST).toEqual({
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      private: manifest.private,
      engines: manifest.engines,
      dsh: manifest.dsh,
    });
    expect(SURVEYS_DSH_MANIFEST.dsh.profile.bundles).toEqual([
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-sdk-app",
    ]);
  });

  it("锁版 dsh 实际加载包根 manifest 并合成带遥测防护的 sdk profile", async () => {
    const { loadProfileDirectory, composeEntries } = await lockedDshAppBoot();
    const dshManifest = JSON.parse(readFileSync(DSH_PACKAGE_JSON, "utf8"));
    expect(dshManifest.version).toBe("0.2.2-rc.4");

    const temp = mkdtempSync(join(tmpdir(), "surveys-dsh-profile-"));
    try {
      const profileDir = join(temp, "profile");
      const bundleDir = join(profileDir, "node_modules", "@mango-write", "surveys");
      mkdirSync(bundleDir, { recursive: true });
      for (const file of ["package.json", "cordis.patch.yml"]) {
        copyFileSync(join(PACKAGE_ROOT, file), join(bundleDir, file));
      }
      writeFileSync(join(profileDir, "package.json"), JSON.stringify({
        name: "surveys-dsh-contract-test",
        private: true,
        dsh: {
          profile: {
            bundles: [
              "@deepseek-ai/dsh-base",
              "@deepseek-ai/dsh-sdk-app",
              "@mango-write/surveys",
            ],
          },
        },
      }));

      const profile = loadProfileDirectory("surveys-test", profileDir, DSH_PACKAGE_JSON);
      expect(profile.skippedBundles).toEqual([]);
      expect(profile.layers.map((layer) => layer.packageName)).toEqual([
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-sdk-app",
        "@mango-write/surveys",
      ]);
      expect(profile.layers[2]!.patchPaths).toEqual([join(bundleDir, "cordis.patch.yml")]);

      const warnings: string[] = [];
      const entries = composeEntries(profile.layers.map((layer) => layer.patches), warnings.push.bind(warnings));
      const rowById = (id: string) => entries.find((entry) => entry["id"] === id);
      expect(warnings).toEqual([]);
      expect(rowById("agent")).toBeDefined();
      expect(rowById("sdk-jsonrpc-server")).toBeDefined();
      expect(rowById("session-log-deepseek")?.["config"]).toMatchObject({ enabled: false });
      expect(rowById("session-telemetry-otel")?.["disabled"]).toBe(true);
      expect(rowById("otel")?.["disabled"]).toBe(true);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
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

  it("四种真实成功回执均通过锁版 dsh-tools 的独立严格 schema", async () => {
    const { assertSupportedJsonSchema, validateJsonSchemaValue } = await lockedDshTools();
    const { tools, receipts } = await executeSuccessfulReceipts();
    expect(new Set(tools.map((tool) => tool.output.schema)).size).toBe(4);
    for (const tool of tools) {
      expect(tool.output.schema["additionalProperties"]).toBe(false);
      expect(() => assertSupportedJsonSchema(tool.output.schema)).not.toThrow();
      const value = receipts[tool.name as keyof typeof receipts];
      expect(validateJsonSchemaValue(tool.output.schema, value), tool.name).toEqual([]);
    }
  });

  it("read/edit/create/review 回执字段漂移会被锁版 dsh-tools 拒绝", async () => {
    const { validateJsonSchemaValue } = await lockedDshTools();
    const { tools, receipts } = await executeSuccessfulReceipts();
    const drifted = {
      survey_read: { ...receipts.survey_read, draftVersion: "3" },
      survey_edit: { ...receipts.survey_edit, operationId: 42 },
      survey_create: { ...receipts.survey_create, questionCount: "1" },
      survey_review: {
        ...receipts.survey_review,
        findings: [{
          id: "f1",
          title: "漂移诊断",
          severity: "critical",
          reason: "严重级别不在契约中",
          recommendation: "重新登记",
        }],
      },
    };
    for (const tool of tools) {
      const value = drifted[tool.name as keyof typeof drifted];
      expect(validateJsonSchemaValue(tool.output.schema, value), tool.name).not.toEqual([]);
    }
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
