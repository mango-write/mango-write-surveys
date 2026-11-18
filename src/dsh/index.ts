// dsh 组件兼容适配层（零 @deepseek-ai/* 运行时或类型依赖）：
// 1) toDshSurveyTools：将 buildSurveyAiTools(service) 投影为对齐 @deepseek-ai/dsh-tools
//    defineTool 的工具定义结构，内置 AbortSignal 预检与稳定大写错误码。
// 2) SURVEYS_DSH_MANIFEST：对齐 @deepseek-ai/dsh-package-manifest DshPackageManifest v1 的静态清单模板。
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

const CANONICAL_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: true,
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
  return {
    name: spec.name,
    description,
    parameters: spec.parameters,
    isConcurrencySafe: () => !spec.write && spec.name === "survey_read",
    output: {
      schema: CANONICAL_OUTPUT_SCHEMA,
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
    bundle: {
      patch: "cordis.patch.yml",
      listedByDefault: true,
    },
    client: {
      platform: "web",
      external: ["@mango-write/surveys/mount"],
    },
  },
};
