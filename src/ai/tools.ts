// 问卷 AI 工具四件套（issue #217/#224）：survey_read（完整定义 + 标准索引）/
// survey_edit（ops 批量改卷，host-applied：服务端只校验不落库，宿主页面应用并
// 走撤销栈与自动保存）/ survey_create（新资源直写：建行 + 存草稿定义）/
// survey_review（模型阅读后登记结构化诊断，不落库、不改卷、不冒充真人验证）。
// AI 永不触碰发布与状态机——模块里没有这类工具，描述里也明说。工具契约是包自
// 有的 SurveyAiToolSpec；宿主（主站 copilot、独立站）各自映射到自己的声明格式。
// 交付载荷经 surveyDeliveryFromResult 摘出 UI 面：随 tool_step done 帧下发、
// 只进 UI 不回灌模型。
import { createHash } from "node:crypto";
import { z } from "zod";

import { SurveyReviewFindingSchema, type SurveyReviewFinding } from "../contracts/index.js";
import {
  applySurveyOps,
  validateSurveyDefinition,
  validateSurveyDesign,
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
import {
  AGENT_REVIEW_DISCLAIMER,
  STANDARDS_CHECK_IDS,
  compactStandardsDigest,
  standardsCheckDetail,
} from "./standards-hint.js";

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
  surveyReview: SurveyAiToolSpec;
}

// 研究设计依据（#224）：生成前先写清楚要回答什么、对谁、怎么分析。未知事实
// 进 pendingDecisions/assumptions，不编造人群、许可与验证状态。
export const RESEARCH_DESIGN_HINT =
  "definition.researchDesign（可选但生成时必须给）：{researchQuestion,population,recruitment," +
  "purpose:'describe'|'compare'|'measure',timeBudgetMinutes,constructs:[{id,label,definition,questionIds:[题 id]}]," +
  "analysisPlan,assumptions:[字符串],pendingDecisions:[字符串]}。" +
  "constructs 是「维度 → 题目」映射，题干必须真的能测这个概念；没有题目覆盖的维度会被校验报 design_construct_unmapped。" +
  "人群、招募渠道、许可与既有验证状态不了解时写进 pendingDecisions（或留空并在 analysisPlan/assumptions 说明），不要编造；" +
  "已有问卷补设计用 survey_edit 的 set_meta.researchDesign（null = 清除）。" +
  "可选 pretest:{participantCount,notes,recordedAt} 是作者自报的试填记录，引用它不等于做完独立核验或量表验证。";

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
  "multi_text→items:[{label}](1–20)；statement→body(markdown 说明，非题目，required 必须为 false)。" +
  '筛选追问必须实际配置 showIf:{questionId:"q_used",op:"eq",value:"yes"}（value 是前题选项 id）；' +
  '只在题干写「仅使用者」不会隐藏题目。未使用者题用对应 no 选项条件，不能只在研究设计中声称已跳过。';

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
    argsHint: '{"checkIds":["wording.double_barrel"]}',
    parameters: {
      type: "object",
      properties: {
        checkIds: {
          type: "array",
          items: { type: "string" },
          description:
            "可选：按 id 取标准检查项的完整判据（claim/来源/反例/处理方式），最多 10 条。" +
            "不传则只带紧凑标准索引（id/标题/维度/默认严重级别）。",
        },
      },
      additionalProperties: false,
    },
    write: false,
    hostApplied: false,
    async run(args, ctx) {
      const surveyId = ctx.scopeSurveyId;
      if (!surveyId) {
        return { error: "survey_read 锚定当前问卷：请在问卷工作台的会话里使用本工具。" };
      }
      const requested = Array.isArray(args["checkIds"])
        ? args["checkIds"].filter((id): id is string => typeof id === "string").slice(0, 10)
        : [];
      try {
        const survey = await service.requireSurveyAccess(ctx.actor.userId, surveyId, "read");
        const definition = asDefinition(survey.draftJson);
        const issues = [...validateSurveyDefinition(definition), ...validateSurveyDesign(definition)];
        const detail = requested.length > 0 ? standardsCheckDetail(requested) : null;
        return {
          ok: true,
          surveyId,
          status: survey.status,
          draftVersion: survey.draftVersion,
          // 完整定义是权威内容（诊断必须基于全文，摘要会丢掉措辞与载荷）；
          // summary 只是页/题索引，便于快速定位 id。
          definition,
          summary: summarizeDefinition(definition),
          ...(definition.researchDesign
            ? {}
            : {
                researchDesignHint:
                  "本问卷还没有 researchDesign（研究设计依据）。需要诊断或生成前先让用户确认研究问题/人群/用途，" +
                  "再用 survey_edit 的 set_meta.researchDesign 补上；未知事实进 pendingDecisions，不要编造。",
              }),
          standards: compactStandardsDigest(),
          ...(detail ? { standardsDetail: detail } : {}),
          ...(issues.length > 0 ? { issues, issuesNote: issuesBrief(issues) } : {}),
          note:
            "summary 里的 id 是修改操作（survey_edit）与诊断引用（survey_review）的定位依据；" +
            "survey_edit / survey_review 必须把本次返回的 draftVersion 作为 baseDraftVersion 传入。" +
            "发布与状态变更没有工具，永远由用户手动操作。",
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
            "set_meta{title?,description?,consent?,researchDesign?(null=清除)}（研究设计字段见 definition.researchDesign）；" +
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
        expectedQuestionCount: {
          type: "integer",
          minimum: 1,
          maximum: SURVEY_LIMITS.maxQuestions,
          description:
            "仅当用户本轮明确说了题目数量（如「8 题」）时传入该数字；用户没给具体数字就省略，不要猜。" +
            "definition 里的可答题数（statement 说明块不计入）必须与之完全相等：不符时本工具在建卷前拒绝并回报实际题数，请补齐或删减后重试。",
        },
        definition: {
          type: "object",
          description:
            "完整问卷定义：{version:1,title,description,consent,questions:[...],pages:[...],researchDesign:{...}}。" +
            "生成时必须带 researchDesign（" +
            RESEARCH_DESIGN_HINT +
            "）。" +
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
      const askableCount = definition.questions.filter((question) => question.type !== "statement").length;
      // 用户明确题数时硬校验（#224）：真实模型曾把「8 题」交付成 5 题且无人察觉。
      // 未申报就不设限——不知道题数时不猜、不按示例数字凑。
      const expectedRaw = args["expectedQuestionCount"];
      if (expectedRaw !== undefined && expectedRaw !== null) {
        if (
          typeof expectedRaw !== "number" ||
          !Number.isInteger(expectedRaw) ||
          expectedRaw < 1 ||
          expectedRaw > SURVEY_LIMITS.maxQuestions
        ) {
          return {
            error: `expectedQuestionCount 不合法（${String(expectedRaw)}）：传 1–${SURVEY_LIMITS.maxQuestions} 的整数，用户没明确题数就省略。`,
          };
        }
        // 说明块不是题目（不收集答案），计入会把「7 题 + 1 段说明」蒙成 8 题。
        if (askableCount !== expectedRaw) {
          return {
            error: `题数不符：用户要求 ${expectedRaw} 题，本次 definition 只有 ${askableCount} 题（说明块不计入）。问卷未创建。`,
            expectedQuestionCount: expectedRaw,
            actualQuestionCount: askableCount,
            hint: `按用户要求调整到恰好 ${expectedRaw} 题后重试；本次没有建卷，重试不会留下多份问卷。`,
          };
        }
      }
      const issues = [...validateSurveyDefinition(definition), ...validateSurveyDesign(definition)];
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
          questionCount: askableCount,
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

  const REVIEW_FINDINGS_LIMIT = 20;

  const findingParameters = z.toJSONSchema(SurveyReviewFindingSchema);
  delete findingParameters.$schema;
  const surveyReview: SurveyAiToolSpec = {
    name: "survey_review",
    argsHint:
      '{"baseDraftVersion":3,"summary":"覆盖基本齐全，两处措辞需修订","findings":[{"id":"f1","checkId":"wording.double_barrel","questionId":"q2","title":"双重提问","severity":"major","reason":"题干同时问了两件事","recommendation":"拆成两题","suggestedOps":[{"op":"update_question","questionId":"q2","patch":{"title":"..."}}]}]}',
    parameters: {
      type: "object",
      properties: {
        baseDraftVersion: {
          type: "integer",
          minimum: 1,
          description:
            "诊断所依据的基线：最近一次 survey_read 返回的 draftVersion。问卷在读取后被修改时本工具拒绝（stale_read），需重新读取后再诊断。",
        },
        summary: {
          type: "string",
          description: "一句话概括这次诊断的结论（≤300 字，不能只写「已检查」）。",
        },
        findings: {
          type: "array",
          maxItems: REVIEW_FINDINGS_LIMIT,
          items: findingParameters,
          description:
            `诊断条目（最多 ${REVIEW_FINDINGS_LIMIT} 条；确无发现时给空数组）。每项 {id,checkId,questionId?,title,severity,reason,recommendation,suggestedOps?}：` +
            "checkId 必须是本次 survey_read 返回的标准索引里真实存在的 id；questionId 必须是定义里存在的题目 id。" +
            "severity 用 blocker/major/minor 的目录定义判断；reason 写判据与原文依据，recommendation 写怎么改。" +
            "suggestedOps 只放能安全自动应用的修订（全部会在当前草稿上校验可应用），无法自动修就只写 recommendation。" +
            "各条 suggestedOps 由画布按共同原因合并成整批候选、一次确认后整批应用，无需逐条给出替代方案。" +
            "目录外发现省略 checkId，仍留在 findings 并写清依据与待核验限制，不编造目录依据。",
        },
      },
      required: ["baseDraftVersion", "summary", "findings"],
      additionalProperties: false,
    },
    // 诊断不改问卷、不落库：登记后随 done 帧交付给画布侧栏展示。
    write: false,
    hostApplied: true,
    async run(args, ctx) {
      const surveyId = ctx.scopeSurveyId;
      if (!surveyId) {
        return { error: "survey_review 锚定当前问卷：请在问卷工作台的会话里使用本工具。" };
      }
      const summary = String(args["summary"] ?? "").trim();
      if (!summary) return { error: "缺少 summary：一句话概括诊断结论。" };
      if (summary.length > 300) return { error: "summary 上限 300 字，请压缩成结论。" };
      const rawFindings = args["findings"];
      if (!Array.isArray(rawFindings)) return { error: "缺少 findings：诊断条目数组（可以为空数组）。" };
      if (rawFindings.length > REVIEW_FINDINGS_LIMIT) {
        return { error: `findings 上限 ${REVIEW_FINDINGS_LIMIT} 条，请合并同类问题或拆成多次诊断。` };
      }
      const findings: SurveyReviewFinding[] = [];
      const invalid: Array<{ index: number; reason: string }> = [];
      rawFindings.forEach((raw, index) => {
        const parsed = SurveyReviewFindingSchema.safeParse(raw);
        if (parsed.success) findings.push(parsed.data);
        else {
          const head = parsed.error.issues[0];
          invalid.push({
            index,
            reason: head ? `${head.path.join(".") || "finding"}: ${head.message}` : "条目不合法",
          });
        }
      });
      if (invalid.length > 0) return { error: "findings 形状不合法（诊断未登记）", invalid };
      const seenIds = new Set<string>();
      for (const finding of findings) {
        if (seenIds.has(finding.id)) return { error: `诊断 id 重复：${finding.id}` };
        seenIds.add(finding.id);
      }
      // 引用闭合在查库前先做掉静态部分：checkId 必须真的在标准目录里。
      const knownChecks = new Set(STANDARDS_CHECK_IDS);
      const unknownCheckIds = [...new Set(findings.flatMap((f) => f.checkId ? [f.checkId] : []).filter((id) => !knownChecks.has(id)))];
      if (unknownCheckIds.length > 0) {
        return {
          error: `未知 checkId：${unknownCheckIds.join("、")}`,
          hint: "用 survey_read 返回的 standards.checks 索引里的 id；目录外发现省略 checkId，不要发明依据。",
        };
      }
      const baseDraftVersion = args["baseDraftVersion"];
      if (typeof baseDraftVersion !== "number" || !Number.isInteger(baseDraftVersion) || baseDraftVersion < 1) {
        return { error: "缺少 baseDraftVersion：先 survey_read 拿到 draftVersion，再作为基线传入。" };
      }
      try {
        const survey = await service.requireSurveyAccess(ctx.actor.userId, surveyId, "read");
        if (survey.draftVersion !== baseDraftVersion) {
          return {
            error: `stale_read：问卷在读取后已被修改（基线 ${baseDraftVersion}，当前 ${survey.draftVersion}）。重新 survey_read 后再诊断。`,
            currentDraftVersion: survey.draftVersion,
          };
        }
        const definition = asDefinition(survey.draftJson);
        const questionIds = new Set(definition.questions.map((question) => question.id));
        const unknownQuestions = findings.flatMap((finding) =>
          finding.questionId && !questionIds.has(finding.questionId)
            ? [{ findingId: finding.id, questionId: finding.questionId }]
            : [],
        );
        if (unknownQuestions.length > 0) {
          return {
            error: "诊断引用了不存在的题目（诊断未登记）",
            unknownQuestions,
            hint: "重新 survey_read 拿到当前 questionIds 后重试；不要凭对话记忆猜 id。",
          };
        }
        // suggestedOps 只允许「能安全自动应用」的修订：全部在当前草稿上可应用，
        // 且不允许整卷替换（那是换卷不是修订，也没有发布口子）。
        const opProblems: Array<{ findingId: string; reason: string }> = [];
        for (const finding of findings) {
          if (!finding.suggestedOps || finding.suggestedOps.length === 0) continue;
          const replaced = finding.suggestedOps.find((op) => op.op === "replace_all");
          if (replaced) {
            opProblems.push({ findingId: finding.id, reason: "replace_all 是整卷替换，不是可安全自动应用的修订" });
            continue;
          }
          const result = applySurveyOps(definition, finding.suggestedOps);
          if (result.rejected.length > 0) {
            opProblems.push({
              findingId: finding.id,
              reason: result.rejected.map((entry) => entry.reason).join("；"),
            });
          } else {
            finding.suggestedOps = result.applied;
          }
        }
        if (opProblems.length > 0) {
          return {
            error: "suggestedOps 未通过可应用性校验（诊断未登记）",
            opProblems,
            hint: "无法安全自动修的条目只保留 recommendation；能修的按 survey_edit 词表给出可应用操作。",
          };
        }
        return {
          ok: true,
          surveyId,
          operationId: ctx.operationId,
          baseDraftVersion,
          summary,
          findings,
          note:
            "诊断已登记并展示在用户的问卷画布：画布会把可自动修订的 suggestedOps 按共同原因合并成至多 3 组候选，" +
            "用户一次确认即整批应用（不是逐条应用，也没有只应用一部分的中间态）；没有 suggestedOps 的条目只作人工待办。" +
            `${AGENT_REVIEW_DISCLAIMER}向用户转述结论与建议时不得声称问卷已验证、已通过或已发布；` +
            "按组概括改动，不要把建议拆成逐条确认；" +
            "要把「确定的问题」「有依据的风险」「还缺证据的判断」说清楚。",
        };
      } catch (err) {
        if (err instanceof SurveyError) return { error: `问卷不可读（${err.code}）` };
        throw err;
      }
    },
  };

  return { surveyRead, surveyEdit, surveyCreate, surveyReview };
}

/** 行为注册入口：宿主把四件套交给自己的工具注册面（1:1 注册，宿主治理目录
 *  仍以 name 为键核对）。 */
export function registerSurveyAiTools(
  tools: SurveyAiTools,
  register: (tool: SurveyAiToolSpec) => void,
): void {
  register(tools.surveyRead);
  register(tools.surveyEdit);
  register(tools.surveyCreate);
  register(tools.surveyReview);
}
