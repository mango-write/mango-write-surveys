// 问卷 AI 工具三件套（issue #217/#223 §6）：survey_read（L0 读摘要定位 id）/
// survey_edit（ops 批量改卷，host-applied：服务端只校验不落库，宿主页面应用并
// 走撤销栈与自动保存）/ survey_create（新资源直写：建行 + 存草稿定义）。
// AI 永不触碰发布与状态机——模块里没有这类工具，描述里也明说。工具契约是包自
// 有的 SurveyAiToolSpec；宿主（主站 copilot、独立站）各自映射到自己的声明格式。
// 交付载荷经 surveyDeliveryFromResult 摘出 UI 面：随 tool_step done 帧下发、
// 只进 UI 不回灌模型。
import { createHash } from "node:crypto";

import {
  applySurveyOps,
  validateSurveyDefinition,
  SURVEY_LIMITS,
  SurveyDefinitionSchema,
  type SurveyDefinition,
  type SurveyIssue,
  type SurveyOp,
  type SurveyQuestion,
} from "../core/index.js";

import { SurveyError } from "../server/errors.js";
import { asDefinition, type SurveysService } from "../server/service.js";
import type { SurveysActor } from "../ports.js";

/** (userId, operationId) → 确定性 UUIDv5 形态 sha256（与主站
 *  deriveNativeClientRequestId 同一手法）：同一次 AI 建卷操作的重试恒得同一
 *  surveyId，幂等键不需要额外存储。 */
export function idempotentSurveyId(userId: string, operationId: string): string {
  const hex = createHash("sha256").update(JSON.stringify([userId, operationId])).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** AI 调用上下文：宿主从自己的会话/身份状态组装，包不感知传输层。 */
export interface SurveyAiContext {
  actor: SurveysActor;
  /** survey scope 会话锚定的问卷 id；非 survey 会话为 null（工具给出引导性错误）。 */
  scopeSurveyId: string | null;
  /** 本次 AI 操作的身份：宿主按「一次逻辑工具调用」提供（主站为 agent 的
   *  toolCallId）——同一条消息里两次工具调用是两个操作，同一调用的重放同 id。
   *  survey_create 以 (userId, operationId) 确定性派生 surveyId 做建卷幂等；
   *  survey_edit 把它随交付带给页面做去重。 */
  operationId: string;
}

export interface SurveyAiToolSpec {
  name: string;
  argsHint: string;
  /** JSON Schema（宿主原样透传给自己的参数声明面）。 */
  parameters: Record<string, unknown>;
  write: boolean;
  /** 交付由宿主处理：工具桩完成不证明提交。 */
  hostApplied: boolean;
  run(args: Record<string, unknown>, ctx: SurveyAiContext): Promise<Record<string, unknown>>;
}

export interface SurveyAiTools {
  surveyRead: SurveyAiToolSpec;
  surveyEdit: SurveyAiToolSpec;
  surveyCreate: SurveyAiToolSpec;
}

// 题型词表（与 core definition.ts 同步；描述里给模型载荷要点）。工具参数与
// runner 的 system 提示词共用这一份，不复制两份。
export const QUESTION_PAYLOAD_HINT =
  "题型词表与必填载荷：single/multiple/dropdown/ranking→options:[{label,exclusive?}]" +
  "（multiple 可加 minChoices/maxChoices）；image_single/image_multiple→options:[{label,imageFileId?}]" +
  "（imageFileId 只能引用用户已上传的媒体 id，不要发明 id；image_multiple 可加 minChoices/maxChoices）；" +
  "text→multiline?,maxLength?；number→min?,max?；" +
  "scale→min,max(跨度≤10),minLabel?,maxLabel?；rating→max(3–10)；nps→minLabel?,maxLabel?(0–10 固定)；" +
  "date→min?,max?(YYYY-MM-DD)；time→无载荷；matrix_single/matrix_multiple→rows:[{label}](1–20),columns:[{label}](2–10)；" +
  "matrix_text→rows:[{label}](1–20)，每行一个文本框，无 columns；" +
  "multi_text→items:[{label}](1–20)；statement→body(markdown 说明，非题目，required 必须为 false)。";

const optionSummary = (question: SurveyQuestion): string => {
  switch (question.type) {
    case "single":
    case "multiple":
    case "dropdown":
    case "ranking":
      return question.options.map((option) => `${option.id}:${option.label}${option.exclusive ? "(互斥)" : ""}`).join("；");
    case "image_single":
    case "image_multiple":
      // imageFileId 由用户上传产生，模型不发明。
      return question.options
        .map((option) => `${option.id}:${option.label}${option.imageFileId ? "(带图)" : ""}${option.exclusive ? "(互斥)" : ""}`)
        .join("；");
    case "scale":
      return `量程 ${question.min}–${question.max}${question.minLabel ? `（${question.minLabel}）` : ""}${question.maxLabel ? `（${question.maxLabel}）` : ""}`;
    case "rating":
      return `档位 1–${question.max}`;
    case "nps":
      return "NPS 0–10";
    case "number":
      return `数字${question.min !== undefined || question.max !== undefined ? ` ${question.min ?? "-∞"}–${question.max ?? "∞"}` : ""}`;
    case "text":
      return `文本${question.multiline ? "多行" : ""}${question.maxLength ? `≤${question.maxLength}字` : ""}`;
    case "date":
      return `日期${question.min || question.max ? ` ${question.min ?? "…"}–${question.max ?? "…"}` : ""}`;
    case "matrix_single":
    case "matrix_multiple":
      return `矩阵：行[${question.rows.map((row) => row.label).join("、")}] 列[${question.columns.map((column) => column.label).join("、")}]`;
    case "matrix_text":
      return `矩阵填空：行[${question.rows.map((row) => row.label).join("、")}]，每行一个文本框`;
    case "multi_text":
      return `多项填空：${question.items.map((item) => item.label).join("、")}`;
    case "statement":
      return `说明块：${question.body.slice(0, 80)}`;
    default:
      return "";
  }
};

/** 紧凑摘要：模型据此拿到页/题 id 与结构，不回灌完整 JSON。 */
function summarizeDefinition(definition: SurveyDefinition): string {
  const lines: string[] = [
    `标题：${definition.title}`,
    definition.description ? `研究说明：${definition.description.slice(0, 120)}` : "研究说明：（空）",
    definition.consent ? `知情同意文案：已填写` : "知情同意文案：（空）",
  ];
  definition.pages.forEach((page, index) => {
    lines.push(
      `页${index + 1} id=${page.id}「${page.title}」` +
        (page.description ? `（说明：${page.description.slice(0, 60)}）` : "") +
        (page.jump ? ` [跳页：当 ${page.jump.when.questionId} ${page.jump.when.op} ${String(page.jump.when.value)} → ${page.jump.targetPageId}]` : ""),
    );
    for (const questionId of page.questionIds) {
      const question = definition.questions.find((candidate) => candidate.id === questionId);
      if (!question) continue;
      lines.push(
        `  - id=${question.id} [${question.type}]${question.required ? "必答" : "选答"}` +
          `「${question.title.slice(0, 60)}」 ${optionSummary(question)}` +
          (question.showIf ? ` [显示条件：${question.showIf.questionId} ${question.showIf.op} ${String(question.showIf.value)}]` : ""),
      );
    }
  });
  return lines.join("\n");
}

const issuesBrief = (issues: SurveyIssue[]): string =>
  issues.map((issue) => `${issue.path} ${issue.code}: ${issue.message}`).join("；");

export function createSurveyAiTools(service: SurveysService): SurveyAiTools {
  const surveyRead: SurveyAiToolSpec = {
    name: "survey_read",
    argsHint: "{}",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    write: false,
    hostApplied: false,
    async run(_args, ctx) {
      const surveyId = ctx.scopeSurveyId;
      if (!surveyId) {
        return { error: "survey_read 锚定当前问卷：请在问卷工作台的会话里使用本工具。" };
      }
      try {
        const survey = await service.requireSurveyAccess(ctx.actor.userId, surveyId, "read");
        const definition = asDefinition(survey.draftJson);
        const issues = validateSurveyDefinition(definition);
        return {
          ok: true,
          surveyId,
          status: survey.status,
          draftVersion: survey.draftVersion,
          summary: summarizeDefinition(definition),
          ...(issues.length > 0 ? { issues, issuesNote: issuesBrief(issues) } : {}),
          note:
            "summary 里的 id 是修改操作（survey_edit）的定位依据；survey_edit 必须把本次返回的 draftVersion 作为 baseDraftVersion 传入。发布与状态变更没有工具，永远由用户手动操作。",
        };
      } catch (err) {
        if (err instanceof SurveyError) return { error: `问卷不可读（${err.code}）` };
        throw err;
      }
    },
  };

  const OPS_LIMIT = 60;

  const surveyEdit: SurveyAiToolSpec = {
    name: "survey_edit",
    argsHint:
      '{"baseDraftVersion":3,"ops":[{"op":"update_question","questionId":"q1","patch":{"type":"multiple"}}],"summary":"把第 1 题改成多选"}',
    parameters: {
      type: "object",
      properties: {
        baseDraftVersion: {
          type: "integer",
          minimum: 1,
          description:
            "本次修改的基线：survey_read 最近一次返回的 draftVersion。问卷在读取后被别人修改时本工具会拒绝（stale_read），需重新 survey_read。",
        },
        ops: {
          type: "array",
          description:
            "要应用的操作列表（一次调用批量给出，不要拆成多次调用）。每个操作 {op, ...}，词表：" +
            "set_meta{title?,description?,consent?}；" +
            "add_page{title,afterPageId?,description?,pageId?}；" +
            "update_page{pageId,title?,description?(空串=清除)}；" +
            "remove_page{pageId}（题目并入相邻页）；" +
            "add_question{pageId,index?,question}（question 为完整题目载荷，题目与选项/行/列/项 id 可省略，服务端生成）；" +
            "update_question{questionId,patch}（patch 浅合并；showIf:null=清除显示条件；换题型：同族保留载荷，跨族必须在 patch 里给全新载荷如 options/rows+columns）；" +
            "remove_question{questionId}（清理指向它的显示条件与跳页）；" +
            "move_question{questionId,toPageId,index}；" +
            "set_page_jump{pageId,jump:{when:{questionId,op,value},targetPageId}|null}；" +
            "replace_all{definition}（整卷替换，仅「从零生成」场景）。",
        },
        summary: {
          type: "string",
          description: "一句话向用户概括这次改了什么（将显示在撤销按钮旁），≤60 字。",
        },
      },
      required: ["baseDraftVersion", "ops", "summary"],
      additionalProperties: false,
    },
    write: true,
    // host-applied：服务端不落库——应用发生在用户页面（本地重放 ops + 撤销栈 +
    // 自动保存）。工具桩完成不证明提交，页面应用结果经下一轮对话或用户可见。
    hostApplied: true,
    async run(args, ctx) {
      const surveyId = ctx.scopeSurveyId;
      if (!surveyId) {
        return { error: "survey_edit 锚定当前问卷：请在问卷工作台的会话里使用本工具。" };
      }
      const summary = String(args["summary"] ?? "").trim();
      if (!summary) return { error: "缺少 summary：一句话说明这次改了什么。" };
      const ops = Array.isArray(args["ops"]) ? args["ops"] : null;
      if (!ops || ops.length === 0) return { error: "缺少 ops：至少一个操作。" };
      if (ops.length > OPS_LIMIT) {
        return { error: `单次 ops 上限 ${OPS_LIMIT} 条，请拆成多次修改。` };
      }
      const baseDraftVersion = args["baseDraftVersion"];
      if (
        typeof baseDraftVersion !== "number" ||
        !Number.isInteger(baseDraftVersion) ||
        baseDraftVersion < 1
      ) {
        return { error: "缺少 baseDraftVersion：先 survey_read 拿到 draftVersion，再作为基线传入。" };
      }
      try {
        const survey = await service.requireSurveyAccess(ctx.actor.userId, surveyId, "write");
        // 新鲜度基线取模型实际观察到的版本（survey_read 返回、由模型回传），
        // 不是执行时的当前版本：用户在模型读取与改卷之间保存的编辑，会让基线
        // 落后——这里拒绝并让模型重读，防止旧读结果经服务端盖章后覆盖人工编辑。
        if (survey.draftVersion !== baseDraftVersion) {
          return {
            error: `stale_read：问卷在读取后已被修改（基线 ${baseDraftVersion}，当前 ${survey.draftVersion}）。重新 survey_read 后基于新版本重试。`,
            currentDraftVersion: survey.draftVersion,
          };
        }
        const definition = asDefinition(survey.draftJson);
        const result = applySurveyOps(definition, ops);
        if (result.applied.length === 0) {
          return {
            error: "全部操作被拒绝，definition 未变。",
            rejected: result.rejected.map((entry) => ({ reason: entry.reason })),
            hint: "先用 survey_read 拿到真实的页/题 id，再按词表重试。",
          };
        }
        return {
          ok: true,
          surveyId,
          operationId: ctx.operationId,
          // 基线 = 模型观察并回传的版本（上面已校验与当前一致）；页面拿它与
          // 本地副本比对，不新鲜不自动应用。
          baseDraftVersion,
          summary: summary.slice(0, 300),
          appliedCount: result.applied.length,
          // 已应用操作（含服务端生成的 id）：页面在本地草稿上重放这批操作。
          appliedOps: result.applied,
          ...(result.rejected.length > 0
            ? { rejected: result.rejected.map((entry) => ({ reason: entry.reason })) }
            : {}),
          ...(result.issues.length > 0 ? { issues: result.issues } : {}),
          note:
            "操作已交付到用户的问卷画布（自动保存并可通过撤销恢复）。向用户转述修改内容即可；" +
            "不要复述 appliedOps JSON。拒绝项与剩余 issue 请如实转述。",
        };
      } catch (err) {
        if (err instanceof SurveyError) {
          return { error: err.code === "forbidden" ? "对该问卷没有写权限。" : `问卷不可读（${err.code}）` };
        }
        throw err;
      }
    },
  };

  const surveyCreate: SurveyAiToolSpec = {
    name: "survey_create",
    argsHint: '{"title":"科研工具使用习惯调查","definition":{...完整问卷定义...}}',
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: `问卷标题，1–${SURVEY_LIMITS.maxTitleLength} 字。`,
        },
        definition: {
          type: "object",
          description:
            "完整问卷定义：{version:1,title,description,consent,questions:[...],pages:[...]}。" +
            "questions 每项含 id(可省略自动生成)/type/title(纯文本)/required 与题型载荷（" +
            QUESTION_PAYLOAD_HINT +
            "）。pages 每项含 id(可省略)/title/questionIds（每题恰属一页；页序 = 全卷题序）。" +
            "显示条件/跳页条件 showIf/jump 只能引用排在前面的题，条件源允许表：" +
            "single/dropdown/image_single→eq+选项id；multiple/image_multiple→contains+选项id；number/scale/rating/nps→eq+数字；" +
            "date/time/text→eq+字符串；矩阵/矩阵填空/排序/多项填空/说明块不能作条件源。" +
            "description 与 consent 可写研究说明与知情同意（markdown）；不发布、不改状态——发布由用户手动操作。",
        },
      },
      required: ["title", "definition"],
      additionalProperties: false,
    },
    write: true,
    // 新资源直写（无客户端状态、可删除、不触发布）：不需要确认门，用户这条消息
    // 本身就是显式命令；创建结果经 survey_create 交付帧导航到工作区。
    hostApplied: true,
    async run(args, ctx) {
      const title = String(args["title"] ?? "").trim();
      if (!title) return { error: "缺少 title。" };
      const raw = args["definition"];
      if (!raw || typeof raw !== "object") return { error: "缺少 definition：完整问卷定义。" };
      const candidate = { ...(raw as Record<string, unknown>), title };
      const parsed = SurveyDefinitionSchema.safeParse(candidate);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return {
          error: `definition 形状不合法：${issue ? `${issue.path.join(".")}: ${issue.message}` : "未知错误"}`,
          hint: QUESTION_PAYLOAD_HINT,
        };
      }
      const definition = parsed.data as SurveyDefinition;
      const issues = validateSurveyDefinition(definition);
      try {
        const created = await service.createSurvey(ctx.actor, {
          title,
          // 建卷幂等：surveyId 由 (userId, operationId) 派生，同一次操作的
          // 重试拿到同一份问卷，不重复建行。
          idempotentSurveyId: idempotentSurveyId(ctx.actor.userId, ctx.operationId),
        });
        // 重试落进「已建并已存草稿」的问卷（版本 >1）时跳过重复写草稿；
        // 落在「已建未存」（崩溃窗口）时 expectedVersion=1 恰好补上。
        if (created.draftVersion === 1) {
          // 草稿保存只验形状（空页等是合法草稿态）；语义 issues 随回执告知模型与用户。
          await service.updateSurvey(ctx.actor.userId, created.id, {
            expectedVersion: 1,
            definition,
          });
        }
        return {
          ok: true,
          surveyId: created.id,
          operationId: ctx.operationId,
          title,
          questionCount: definition.questions.length,
          pageCount: definition.pages.length,
          ...(issues.length > 0 ? { issues, issuesNote: issuesBrief(issues) } : {}),
          note:
            "问卷已创建并打开在用户的工作区。向用户转述结构（页数/题数/覆盖的主题）；" +
            "不要复述 definition JSON。语义 issue（若有）请如实转述。发布由用户手动操作。",
        };
      } catch (err) {
        if (err instanceof SurveyError) {
          return { error: err.code === "forbidden" ? "当前身份没有创建问卷的权限。" : `创建失败（${err.code}）` };
        }
        throw err;
      }
    },
  };

  return { surveyRead, surveyEdit, surveyCreate };
}

/** 行为注册入口：宿主把三件套交给自己的工具注册面（1:1 注册，宿主治理目录
 *  仍以 name 为键核对）。 */
export function registerSurveyAiTools(
  tools: SurveyAiTools,
  register: (tool: SurveyAiToolSpec) => void,
): void {
  register(tools.surveyRead);
  register(tools.surveyEdit);
  register(tools.surveyCreate);
}
