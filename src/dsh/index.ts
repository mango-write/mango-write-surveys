// dsh 组件兼容适配层（零 @deepseek-ai/* 运行时或类型依赖）：
// 1) toDshSurveyTools：将 buildSurveyAiTools(service) 投影为对齐 @deepseek-ai/dsh-tools
//    defineTool 的工具定义结构，内置 AbortSignal 预检与稳定大写错误码。
// 2) SURVEYS_DSH_MANIFEST：包根 DshPackageManifest v1 的同步投影，由锁版加载测试防漂移。
import { randomUUID } from "node:crypto";

import type { ToolSurveyDelivery } from "../contracts/index.js";
import type { SurveysActor } from "../ports.js";
import { SurveyError } from "../server/errors.js";
import type { createPretestService } from "../server/pretest.js";
import type { SurveysService } from "../server/service.js";
import { surveyDeliveryFromResult } from "../ai/delivery.js";
import { buildSurveyAiTools, type SurveyAiToolSpec } from "../ai/tools.js";

export type DshSurveyErrorCode =
  | "ABORTED"
  | "CONTEXT_UNAVAILABLE"
  | "SCOPE_REQUIRED"
  | "STALE_READ"
  | "VERSION_CONFLICT"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SOURCE_CAPACITY"
  | "VALIDATION_FAILED"
  | "EXECUTION_FAILED";

export interface DshSurveyToolErrorInfo {
  readonly name: string;
  readonly code: DshSurveyErrorCode;
  readonly reason?: string;
}

export class DshSurveyToolError extends Error {
  readonly code: DshSurveyErrorCode;
  readonly info: DshSurveyToolErrorInfo;
  readonly details?: Record<string, unknown>;

  constructor(
    code: DshSurveyErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DshSurveyToolError";
    this.code = code;
    this.info = { name: "DshSurveyToolError", code, reason: message };
    if (details) this.details = details;
  }
}

export interface DshSurveyToolExecContext {
  readonly actor: SurveysActor;
  readonly scopeSurveyId: string | null;
  readonly signal?: AbortSignal;
  readonly callId?: string;
  readonly operationId?: string;
  readonly userTexts?: readonly string[];
  readonly includePretestFeedback?: boolean;
}

export interface DshSurveyToolContentBlock {
  readonly type: "text";
  readonly text: string;
}

export interface DshSurveyToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly isConcurrencySafe: (args: unknown) => boolean;
  readonly output: {
    readonly schema: Record<string, unknown>;
    render(args: unknown, value: Record<string, unknown>): DshSurveyToolContentBlock[];
    presentationMeta(args: unknown, value: Record<string, unknown>): ToolSurveyDelivery | null;
  };
  execute(
    args: Record<string, unknown>,
    ctx: DshSurveyToolExecContext,
  ): Promise<Record<string, unknown>>;
}

const TOOL_DESCRIPTIONS: Record<string, string> = {
  survey_read:
    "读取当前问卷草稿的完整定义、研究设计、页/题 id、选项、条件与标准检查索引。任何 survey_edit 或 survey_review 之前必须先调用以获取真实 id 与 draftVersion。",
  survey_edit:
    "批量修改当前问卷草稿（校验 baseDraftVersion 后在服务端原子落盘并返回最新 draftVersion 与完整 definition 快照）。不执行发布或采集状态变更。",
  survey_create:
    "从零创建一份新问卷草稿并写入完整问卷定义与研究设计（按 operationId 幂等建卷）。不执行发布或采集状态变更。",
  survey_review:
    "基于完整问卷定义登记结构化方法学诊断建议并持久化（不直接修改问卷正文，需回传 baseDraftVersion）。",
};

type DshJsonSchema = Record<string, unknown>;

const stringSchema = { type: "string" } as const;
const stringArraySchema = { type: "array", items: stringSchema } as const;
const objectSchema = (
  properties: Record<string, DshJsonSchema>,
  required: readonly string[] = [],
  additionalProperties = false,
): DshJsonSchema => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required: [...required] } : {}),
  additionalProperties,
});
const arraySchema = (items: DshJsonSchema): DshJsonSchema => ({ type: "array", items });

const DEFINITION_OUTPUT_SCHEMA = objectSchema(
  {
    version: { type: "integer", const: 1 },
    title: stringSchema,
    description: stringSchema,
    consent: stringSchema,
    questions: arraySchema({ type: "object" }),
    pages: arraySchema({ type: "object" }),
    researchDesign: { type: "object" },
    sourceRecords: arraySchema({ type: "object" }),
  },
  ["version", "title", "description", "consent", "questions", "pages"],
  true,
);
const ISSUE_OUTPUT_SCHEMA = objectSchema(
  { path: stringSchema, code: stringSchema, message: stringSchema },
  ["path", "code", "message"],
);
const ISSUES_OUTPUT_SCHEMA = arraySchema(ISSUE_OUTPUT_SCHEMA);
const OPERATION_OUTPUT_SCHEMA = { type: "object" } as const;
const REVIEW_FINDING_OUTPUT_SCHEMA = objectSchema(
  {
    id: stringSchema,
    checkId: stringSchema,
    questionId: stringSchema,
    title: stringSchema,
    severity: { type: "string", enum: ["blocker", "major", "minor"] },
    reason: stringSchema,
    recommendation: stringSchema,
    impact: stringSchema,
    evidence: stringSchema,
    suggestedOps: arraySchema(OPERATION_OUTPUT_SCHEMA),
  },
  ["id", "title", "severity", "reason", "recommendation"],
);

const SURVEY_TOOL_OUTPUT_SCHEMAS: Record<string, DshJsonSchema> = {
  survey_read: objectSchema(
    {
      ok: { type: "boolean", const: true },
      surveyId: stringSchema,
      status: { type: "string", enum: ["draft", "published", "paused", "closed"] },
      draftVersion: { type: "integer" },
      definition: DEFINITION_OUTPUT_SCHEMA,
      sourceContext: arraySchema(objectSchema(
        {
          questionId: stringSchema,
          sourceId: stringSchema,
          language: stringSchema,
          state: { type: "string", enum: ["unchanged", "modified", "missing"] },
          source: { oneOf: [{ type: "object" }, { type: "null" }] },
          note: stringSchema,
        },
        ["questionId", "sourceId", "language", "state", "source", "note"],
      )),
      summary: stringSchema,
      reviewSignals: arraySchema(objectSchema(
        {
          questionId: stringSchema,
          kind: { type: "string", enum: ["recall_period", "frequency_anchors"] },
          note: stringSchema,
        },
        ["questionId", "kind", "note"],
      )),
      reviewSignalsNote: stringSchema,
      pretestFeedback: objectSchema(
        {
          entries: arraySchema(objectSchema(
            {
              questionId: stringSchema,
              aspect: stringSchema,
              note: stringSchema,
              count: { type: "integer" },
              questionTitle: stringSchema,
              currentContent: { type: "boolean" },
            },
            ["questionId", "aspect", "note", "questionTitle", "currentContent"],
          )),
          omitted: { type: "integer" },
          note: stringSchema,
        },
        ["entries", "omitted", "note"],
      ),
      researchDesignHint: stringSchema,
      standards: objectSchema(
        {
          status: stringSchema,
          disclaimer: stringSchema,
          severity: arraySchema(objectSchema(
            { id: stringSchema, name: stringSchema, definition: stringSchema },
            ["id", "name", "definition"],
          )),
          checks: arraySchema(objectSchema(
            {
              id: stringSchema,
              title: stringSchema,
              dimension: stringSchema,
              severity: stringSchema,
              classification: stringSchema,
              researchTypes: stringArraySchema,
              questionTypes: stringArraySchema,
            },
            ["id", "title", "dimension", "severity", "classification"],
          )),
          matchingRule: stringSchema,
          unmatchable: stringSchema,
        },
        ["status", "disclaimer", "severity", "checks", "matchingRule", "unmatchable"],
      ),
      standardsDetail: objectSchema(
        { checks: arraySchema({ type: "object" }), unknownCheckIds: stringArraySchema },
        ["checks", "unknownCheckIds"],
      ),
      issues: ISSUES_OUTPUT_SCHEMA,
      issuesNote: stringSchema,
      note: stringSchema,
    },
    ["ok", "surveyId", "status", "draftVersion", "definition", "summary", "standards", "note"],
  ),
  survey_edit: objectSchema(
    {
      ok: { type: "boolean", const: true },
      surveyId: stringSchema,
      operationId: stringSchema,
      baseDraftVersion: { type: "integer" },
      draftVersion: { type: "integer" },
      definition: DEFINITION_OUTPUT_SCHEMA,
      summary: stringSchema,
      appliedCount: { type: "integer" },
      appliedOps: arraySchema(OPERATION_OUTPUT_SCHEMA),
      rejected: arraySchema(objectSchema({ reason: stringSchema }, ["reason"])),
      issues: ISSUES_OUTPUT_SCHEMA,
      note: stringSchema,
    },
    [
      "ok", "surveyId", "operationId", "baseDraftVersion", "draftVersion",
      "definition", "summary", "appliedCount", "appliedOps", "note",
    ],
  ),
  survey_create: objectSchema(
    {
      ok: { type: "boolean", const: true },
      surveyId: stringSchema,
      operationId: stringSchema,
      title: stringSchema,
      questionCount: { type: "integer" },
      pageCount: { type: "integer" },
      issues: ISSUES_OUTPUT_SCHEMA,
      issuesNote: stringSchema,
      note: stringSchema,
    },
    ["ok", "surveyId", "operationId", "title", "questionCount", "pageCount", "note"],
  ),
  survey_review: objectSchema(
    {
      ok: { type: "boolean", const: true },
      surveyId: stringSchema,
      operationId: stringSchema,
      baseDraftVersion: { type: "integer" },
      summary: stringSchema,
      findings: arraySchema(REVIEW_FINDING_OUTPUT_SCHEMA),
      strippedCheckIds: stringArraySchema,
      reanchoredQuestions: arraySchema(objectSchema(
        { findingId: stringSchema, questionId: stringSchema },
        ["findingId", "questionId"],
      )),
      droppedEvidence: stringArraySchema,
      strippedOps: stringArraySchema,
      note: stringSchema,
    },
    ["ok", "surveyId", "operationId", "baseDraftVersion", "summary", "findings", "note"],
  ),
};

function classifyErrorResult(
  toolName: string,
  result: Record<string, unknown>,
): DshSurveyErrorCode {
  const message = typeof result["error"] === "string" ? result["error"] : "";
  if (message.includes("锚定当前问卷")) return "SCOPE_REQUIRED";
  if (message.startsWith("stale_read") || "currentDraftVersion" in result) {
    return "STALE_READ";
  }
  if (message.includes("version_conflict")) return "VERSION_CONFLICT";
  if (message.includes("权限") || message.includes("forbidden")) return "FORBIDDEN";
  if (message.includes("not_found")) return "NOT_FOUND";
  if (message.includes("来源记录已满")) return "SOURCE_CAPACITY";
  if (
    toolName === "survey_edit" ||
    toolName === "survey_create" ||
    toolName === "survey_review"
  ) {
    return "VALIDATION_FAILED";
  }
  return "EXECUTION_FAILED";
}

function classifySurveyException(err: unknown): DshSurveyToolError {
  if (err instanceof DshSurveyToolError) return err;
  if (err instanceof SurveyError) {
    const code: DshSurveyErrorCode =
      err.code === "stale_read"
        ? "STALE_READ"
        : err.code === "version_conflict"
          ? "VERSION_CONFLICT"
          : err.code === "forbidden"
            ? "FORBIDDEN"
            : err.code === "not_found"
              ? "NOT_FOUND"
              : "VALIDATION_FAILED";
    return new DshSurveyToolError(code, err.message);
  }
  return new DshSurveyToolError(
    "EXECUTION_FAILED",
    err instanceof Error ? err.message : String(err),
  );
}

function toDshTool(spec: SurveyAiToolSpec): DshSurveyToolDefinition {
  const description = TOOL_DESCRIPTIONS[spec.name] ?? spec.argsHint;
  const outputSchema = SURVEY_TOOL_OUTPUT_SCHEMAS[spec.name];
  if (!outputSchema) throw new Error(`Missing dsh output schema for ${spec.name}.`);
  return {
    name: spec.name,
    description,
    parameters: spec.parameters,
    isConcurrencySafe: () => !spec.write && spec.name === "survey_read",
    output: {
      schema: outputSchema,
      render(_args, value) {
        return [{ type: "text", text: JSON.stringify(value) }];
      },
      presentationMeta(_args, value) {
        return surveyDeliveryFromResult(spec.name, value);
      },
    },
    async execute(args, ctx) {
      if (ctx.signal?.aborted) {
        throw new DshSurveyToolError("ABORTED", `${spec.name} aborted before dispatch.`);
      }
      if (!ctx.actor?.userId) {
        throw new DshSurveyToolError(
          "CONTEXT_UNAVAILABLE",
          `${spec.name} requires an authenticated actor.`,
        );
      }
      const operationId = ctx.operationId ?? ctx.callId ?? randomUUID();
      let result: Record<string, unknown>;
      try {
        result = await spec.run(args ?? {}, {
          actor: ctx.actor,
          scopeSurveyId: ctx.scopeSurveyId,
          operationId,
          ...(ctx.userTexts ? { userTexts: ctx.userTexts } : {}),
          ...(ctx.includePretestFeedback !== undefined
            ? { includePretestFeedback: ctx.includePretestFeedback }
            : {}),
        });
      } catch (err) {
        if (ctx.signal?.aborted) {
          throw new DshSurveyToolError("ABORTED", `${spec.name} aborted.`);
        }
        throw classifySurveyException(err);
      }
      // 只读工具在返回前若信号已取消则归一为 ABORTED；已落盘写操作保留真实提交回执。
      if (ctx.signal?.aborted && (!spec.write || result["ok"] !== true)) {
        throw new DshSurveyToolError("ABORTED", `${spec.name} aborted.`);
      }
      if (typeof result["error"] === "string") {
        const { error, ...details } = result;
        throw new DshSurveyToolError(
          classifyErrorResult(spec.name, result),
          error,
          Object.keys(details).length > 0 ? details : undefined,
        );
      }
      return result;
    },
  };
}

export function toDshSurveyTools(
  service: SurveysService,
  pretest?: ReturnType<typeof createPretestService>,
): readonly DshSurveyToolDefinition[] {
  const specs = buildSurveyAiTools(service, pretest);
  return [
    toDshTool(specs.surveyRead),
    toDshTool(specs.surveyEdit),
    toDshTool(specs.surveyCreate),
    toDshTool(specs.surveyReview),
  ];
}

/** 对齐 @deepseek-ai/dsh-package-manifest DshPackageManifest v1 的纯类型投影。 */
export interface SurveysDshManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly private?: boolean;
  readonly engines: {
    readonly dsh: string;
    readonly node?: string;
  };
  readonly dsh: {
    readonly manifestVersion: 1;
    readonly profile: {
      readonly bundles: readonly string[];
    };
    readonly bundle: {
      readonly patch: string | readonly string[];
      readonly platforms?: readonly string[];
      readonly listedByDefault?: boolean;
    };
    readonly client: {
      readonly platform: "web";
      readonly inject?: readonly string[];
      readonly immediately?: boolean;
      readonly external?: readonly string[];
    };
  };
}

export const SURVEYS_DSH_MANIFEST: SurveysDshManifest = {
  name: "@mango-write/surveys",
  version: "0.1.0",
  description: "Research survey authoring, collection, and statistical analysis plugin",
  private: true,
  engines: {
    dsh: ">=0.2.2-rc.4",
    node: ">=24.0.0",
  },
  dsh: {
    manifestVersion: 1,
    profile: {
      bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-sdk-app"],
    },
    bundle: {
      patch: "./cordis.patch.yml",
      listedByDefault: true,
    },
    client: {
      platform: "web",
      external: ["@mango-write/surveys/mount"],
    },
  },
};
