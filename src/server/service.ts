// 问卷领域服务：CRUD、发布状态机、导出与 codebook、research-data 只读口。
// 提交、发布、状态与计数均先锁 survey 行再访问子行，串行处理名额和重复提交；
// 锁与事务由宿主 storage port 的 withSurveyLock 提供，锁序写在 ports.ts。
import {
  applySurveyOps,
  canonicalSurveyJson,
  surveyCellValue,
  surveyVariables,
  surveyVariablesOf,
} from "../core/index.js";
import { validateSurveyDefinition } from "../core/index.js";
import {
  SurveyDefinitionSchema,
  ToolSurveyDeliverySchema,
  type CreateSurveyInput,
  type PublicSurvey,
  type SetSurveyStatusInput,
  type SurveyAnswers,
  type SurveyColumnVariable,
  type SurveyCodebook,
  type SurveyDefinition,
  type SurveyDetail,
  type SurveyIssue,
  type SurveyResponseView,
  type SurveyReviewDelivery,
  type SurveyStatus,
  type SurveySummary,
  type UpdateSurveyInput,
} from "../contracts/index.js";
import type {
  SurveysActor,
  SurveysPorts,
  SurveyRecord,
  SurveyResponseRecord,
  SurveyReviewRecord,
  SurveyRevisionRecord,
} from "../ports.js";

import { SurveyError } from "./errors.js";
import {
  SURVEY_DEFINITION_MAX_BYTES,
  SURVEY_MAX_RESPONSES,
} from "./limits.js";
import { collectReleasedMedia } from "./media-lock.js";
import { buildCsv, canonicalJson, durationMs, sha256Hex } from "./serialize.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function isSurveySlug(value: string): boolean {
  return SLUG_RE.test(value);
}

export function asDefinition(value: unknown): SurveyDefinition {
  return value as SurveyDefinition;
}

export function asAnswers(value: unknown): SurveyAnswers {
  return (value ?? {}) as SurveyAnswers;
}

function asReview(row: SurveyReviewRecord | null): SurveyReviewDelivery | null {
  if (!row) return null;
  const parsed = ToolSurveyDeliverySchema.safeParse({
    type: "survey_review",
    surveyId: row.surveyId,
    operationId: row.operationId,
    baseDraftVersion: row.baseDraftVersion,
    summary: row.summary,
    findings: row.findingsJson,
  });
  if (!parsed.success || parsed.data.type !== "survey_review") {
    throw new SurveyError("invalid_review", 500, "诊断记录格式不合法");
  }
  return parsed.data;
}

/** 收集定义里 image_* 题型选项引用的 imageFileId（发布时校验绑定行存在）。 */
function collectImageFileIds(
  definition: SurveyDefinition,
): Array<{ qi: number; oi: number; fileId: string }> {
  const found: Array<{ qi: number; oi: number; fileId: string }> = [];
  definition.questions.forEach((question, qi) => {
    if (question.type !== "image_single" && question.type !== "image_multiple")
      return;
    question.options.forEach((option, oi) => {
      if (option.imageFileId) found.push({ qi, oi, fileId: option.imageFileId });
    });
  });
  return found;
}

/** 新建时的空白模板必须自身可发布：一页一题，非必答；默认单选对齐问卷工具习惯。 */
export function blankDefinition(title: string): SurveyDefinition {
  return {
    version: 1,
    title,
    description: "",
    consent: "",
    questions: [
      {
        id: "q1",
        type: "single",
        title: "问题 1",
        required: false,
        options: [
          { id: "o1", label: "选项 1" },
          { id: "o2", label: "选项 2" },
        ],
      },
    ],
    pages: [{ id: "p1", title: "第 1 页", questionIds: ["q1"] }],
  };
}

/** 草稿保存只验 schema 形状：空页、未完成的条件是编辑器合法中间态，由
 *  发布校验（assertDefinition）拦——否则空页永远存不进去，「保存后空页消失」。 */
function assertDefinitionShape(value: unknown): SurveyDefinition {
  const parsed = SurveyDefinitionSchema.safeParse(value);
  if (!parsed.success)
    throw new SurveyError("invalid_definition", 400, "问卷定义格式不合法");
  const bytes = Buffer.byteLength(canonicalJson(parsed.data), "utf8");
  if (bytes > SURVEY_DEFINITION_MAX_BYTES) {
    throw new SurveyError(
      "definition_too_large",
      413,
      "问卷定义超过 512KiB 上限",
    );
  }
  return parsed.data;
}

function assertDefinition(value: unknown): SurveyDefinition {
  const parsed = SurveyDefinitionSchema.safeParse(value);
  // 形状错误只回 400 不回细节：zod 的 issue 形状是上游实现细节，语义问题另走
  // validateSurveyDefinition 的稳定 {path,code,message}。
  if (!parsed.success)
    throw new SurveyError("invalid_definition", 400, "问卷定义格式不合法");
  const issues = validateSurveyDefinition(parsed.data);
  if (issues.length > 0)
    throw new SurveyError("invalid_definition", 400, "问卷定义不合法", issues);
  return assertDefinitionShape(parsed.data);
}

export function toSummary(row: SurveyRecord): SurveySummary {
  return {
    id: row.id,
    userId: row.userId,
    teamId: row.teamId,
    title: row.title,
    slug: row.slug,
    status: row.status as SurveyStatus,
    currentRevisionId: row.currentRevisionId,
    draftVersion: row.draftVersion,
    completedCount: row.completedCount,
    responseLimit: row.responseLimit,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toResponseView(row: {
  id: string;
  revisionId: string;
  answersJson: unknown;
  startedAt: Date;
  completedAt: Date | null;
}): SurveyResponseView {
  return {
    id: row.id,
    revisionId: row.revisionId,
    answers: asAnswers(row.answersJson),
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? row.startedAt.toISOString(),
    durationMs: durationMs(row.startedAt, row.completedAt),
  };
}

export interface SurveyAccess {
  survey: SurveyRecord;
  canWrite: boolean;
  canDelete: boolean;
}

// 非成员返回 404；归属另一身份的资源由宿主 auth port 抛宿主错误（主站 409
// wrong_tenant）原样穿透包层。
export async function loadSurveyAccess(
  ports: SurveysPorts,
  userId: string,
  surveyId: string,
  operation: "read" | "write" | "delete" = "read",
): Promise<SurveyAccess> {
  if (!UUID_RE.test(surveyId)) throw new SurveyError("not_found", 404);
  const access = await ports.auth.resolveResourceAccess(userId, surveyId);
  if (!access.canRead) throw new SurveyError("not_found", 404);
  if (operation === "write" && !access.canWrite)
    throw new SurveyError("forbidden", 403);
  if (operation === "delete" && !access.canDelete)
    throw new SurveyError("forbidden", 403);
  const survey = await ports.storage.findById(surveyId, { excludeDeleted: true });
  // 软删除后子行仍在（原件供引用），但经 survey 闸一律不可见。
  if (!survey) throw new SurveyError("not_found", 404);
  return { survey, canWrite: access.canWrite, canDelete: access.canDelete };
}

export function createSurveysService(ports: SurveysPorts) {
  const { storage } = ports;

  async function requireSurveyAccess(
    userId: string,
    surveyId: string,
    operation: "read" | "write" | "delete" = "read",
  ): Promise<SurveyRecord> {
    return (await loadSurveyAccess(ports, userId, surveyId, operation)).survey;
  }

  async function detailFrom(access: SurveyAccess): Promise<SurveyDetail> {
    const [startedCount, revisions, review] = await Promise.all([
      // 作答会话与答卷共用存储行：不过滤 finished 才是「已开始」的口径。
      storage.countStarted(access.survey.id),
      storage.listRevisions(access.survey.id),
      storage.findReview(access.survey.id),
    ]);
    return {
      ...toSummary(access.survey),
      startedCount,
      definition: asDefinition(access.survey.draftJson),
      revisions: revisions.map((r) => ({
        id: r.id,
        revision: r.revision,
        createdAt: r.createdAt.toISOString(),
        contentHash: r.contentHash,
      })),
      review: asReview(review),
      canWrite: access.canWrite,
      canDelete: access.canDelete,
    };
  }

  // revision 必须属于本问卷：跨问卷的 revisionId 不能借道读别家的答卷。
  async function requireRevision(
    surveyId: string,
    revisionId: string | null | undefined,
    fallback: string | null,
  ): Promise<SurveyRevisionRecord> {
    const id = revisionId ?? fallback;
    if (!id) throw new SurveyError("revision_required", 400, "需要指定问卷版本");
    if (!UUID_RE.test(id)) throw new SurveyError("not_found", 404);
    const row = await storage.findRevisionOfSurvey(surveyId, id);
    if (!row) throw new SurveyError("not_found", 404);
    return row;
  }

  // 有界答卷行的读取面（storage port 的窄投影，与 listFinishedResponses 契约一致）。
  type FinishedRow = Pick<
    SurveyResponseRecord,
    "id" | "revisionId" | "answersJson" | "startedAt" | "completedAt"
  >;

  async function finishedResponses(
    surveyId: string,
    revisionId: string,
  ): Promise<FinishedRow[]> {
    const rows = await storage.listFinishedResponses(surveyId, revisionId);
    if (rows.length > SURVEY_MAX_RESPONSES)
      throw new SurveyError("dataset_limit_exceeded", 409);
    return rows;
  }

  const getSurveyDetail = async (
    userId: string,
    surveyId: string,
  ): Promise<SurveyDetail> =>
    detailFrom(await loadSurveyAccess(ports, userId, surveyId, "read"));

  return {
    requireSurveyAccess,
    getSurveyDetail,

    async recordReview(
      userId: string,
      surveyId: string,
      input: Omit<SurveyReviewDelivery, "type" | "surveyId">,
    ): Promise<SurveyReviewDelivery> {
      const access = await loadSurveyAccess(ports, userId, surveyId, "write");
      return storage.withSurveyLock(surveyId, async (tx) => {
        const row = await tx.survey();
        if (!row || row.deletedAt) throw new SurveyError("not_found", 404);
        if (row.draftVersion !== input.baseDraftVersion) {
          throw new SurveyError("stale_read", 409, "诊断基线已过期");
        }
        if (input.findings.length === 0) await tx.deleteReview(surveyId);
        else {
          await tx.upsertReview({
            userId: access.survey.userId,
            teamId: access.survey.teamId,
            surveyId,
            ...input,
          });
        }
        return { type: "survey_review", surveyId, ...input };
      });
    },

    async applyReviewFinding(
      userId: string,
      surveyId: string,
      findingId: string,
      expectedVersion: number,
    ): Promise<SurveyDetail> {
      await loadSurveyAccess(ports, userId, surveyId, "write");
      await storage.withSurveyLock(surveyId, async (tx) => {
        const [row, storedReview] = await Promise.all([tx.survey(), tx.review()]);
        const review = asReview(storedReview);
        if (!row || row.deletedAt) throw new SurveyError("not_found", 404);
        if (row.draftVersion !== expectedVersion) {
          throw new SurveyError("version_conflict", 409, "草稿已在别处被修改");
        }
        if (!review) throw new SurveyError("not_found", 404, "诊断记录不存在");
        if (review.baseDraftVersion !== row.draftVersion) {
          throw new SurveyError("review_stale", 409, "诊断基线已过期");
        }
        const finding = review.findings.find((item) => item.id === findingId);
        if (!finding) throw new SurveyError("not_found", 404, "诊断条目不存在");
        if (!finding.suggestedOps?.length) {
          throw new SurveyError("review_not_applicable", 409, "这条建议没有可自动应用的操作");
        }
        const base = asDefinition(row.draftJson);
        const result = applySurveyOps(base, finding.suggestedOps);
        if (
          result.rejected.length > 0 ||
          canonicalSurveyJson(result.definition) === canonicalSurveyJson(base)
        ) {
          throw new SurveyError(
            "review_plan_conflict",
            409,
            "建议与当前问卷冲突",
            result.rejected.map((entry) => ({
              path: findingId,
              code: "review_plan_conflict",
              message: entry.reason,
            })),
          );
        }
        const nextVersion = row.draftVersion + 1;
        const findings = review.findings.filter((item) => item.id !== findingId);
        await tx.updateSurvey({
          title: result.definition.title,
          draftJson: result.definition,
          draftVersion: nextVersion,
        });
        if (findings.length) {
          await tx.updateReview(surveyId, { findings, baseDraftVersion: nextVersion });
        } else {
          await tx.deleteReview(surveyId);
        }
      });
      return getSurveyDetail(userId, surveyId);
    },

    async dismissReviewFinding(
      userId: string,
      surveyId: string,
      findingId: string,
    ): Promise<SurveyDetail> {
      await loadSurveyAccess(ports, userId, surveyId, "write");
      await storage.withSurveyLock(surveyId, async (tx) => {
        const [row, storedReview] = await Promise.all([tx.survey(), tx.review()]);
        const review = asReview(storedReview);
        if (!row || row.deletedAt) throw new SurveyError("not_found", 404);
        if (!review?.findings.some((item) => item.id === findingId)) {
          throw new SurveyError("not_found", 404, "诊断条目不存在");
        }
        const findings = review.findings.filter((item) => item.id !== findingId);
        if (findings.length) await tx.updateReview(surveyId, { findings });
        else await tx.deleteReview(surveyId);
      });
      return getSurveyDetail(userId, surveyId);
    },

    async listSurveys(actor: SurveysActor): Promise<SurveySummary[]> {
      const teamId = actor.space.kind === "team" ? actor.space.teamId : null;
      const access = await ports.auth.resolveSpaceAccess(actor.userId, actor.space);
      if (!access.canRead) throw new SurveyError("not_found", 404);
      const rows = await storage.listByOwner(actor.userId, teamId);
      return rows.map(toSummary);
    },

    async createSurvey(
      actor: SurveysActor,
      input: CreateSurveyInput & { idempotentSurveyId?: string },
    ): Promise<SurveyDetail> {
      const access = await ports.auth.resolveSpaceAccess(actor.userId, actor.space);
      if (!access.canRead) throw new SurveyError("not_found", 404);
      if (!access.canWrite) throw new SurveyError("forbidden", 403);
      const teamId = actor.space.kind === "team" ? actor.space.teamId : null;
      // 幂等建卷（AI survey_create）：同 operationId 派生的 id 已有本身份的
      // 问卷时直接复用，不重复建行；归属不符不借道（派生含 userId，仅防误用）。
      if (input.idempotentSurveyId) {
        const existing = await storage.findById(input.idempotentSurveyId, {
          excludeDeleted: true,
        });
        if (existing && existing.userId === actor.userId && existing.teamId === teamId) {
          return getSurveyDetail(actor.userId, existing.id);
        }
      }
      const definition = blankDefinition(input.title);
      const created = await storage.create({
        userId: actor.userId,
        teamId,
        title: input.title,
        definition,
        ...(input.idempotentSurveyId ? { id: input.idempotentSurveyId } : {}),
      });
      return getSurveyDetail(actor.userId, created.id);
    },

    async updateSurvey(
      userId: string,
      surveyId: string,
      input: UpdateSurveyInput,
    ): Promise<SurveyDetail> {
      await loadSurveyAccess(ports, userId, surveyId, "write");
      const definition = assertDefinitionShape(input.definition);
      // 路由层 schema 已拦 1–10000；service 自身再守一道（存在直连 service 的调用方）。
      if (
        input.responseLimit !== undefined &&
        (!Number.isInteger(input.responseLimit) ||
          input.responseLimit < 1 ||
          input.responseLimit > 10000)
      ) {
        throw new SurveyError("invalid_input", 400, "回收上限不合法");
      }
      await storage.withSurveyLock(surveyId, async (tx) => {
        const row = await tx.survey();
        if (!row || row.deletedAt) throw new SurveyError("not_found", 404);
        // 乐观版本：锁后重读再比，条件更新在并发下不是真 CAS。
        if (row.draftVersion !== input.expectedVersion) {
          throw new SurveyError("version_conflict", 409, "草稿已在别处被修改");
        }
        await tx.updateSurvey({
          title: definition.title,
          draftJson: definition,
          draftVersion: input.expectedVersion + 1,
          ...(input.responseLimit !== undefined
            ? { responseLimit: input.responseLimit }
            : {}),
        });
      });
      return getSurveyDetail(userId, surveyId);
    },

    async publishSurvey(userId: string, surveyId: string): Promise<SurveyDetail> {
      await loadSurveyAccess(ports, userId, surveyId, "write");
      await storage.withSurveyLock(surveyId, async (tx) => {
        const row = await tx.survey();
        if (!row || row.deletedAt) throw new SurveyError("not_found", 404);
        // 关闭是终态：再发布等于静默重开采集，宁可让作者显式新建问卷。
        if (row.status === "closed")
          throw new SurveyError("survey_closed", 409, "问卷已关闭");
        const definition = assertDefinition(row.draftJson);
        if (definition.questions.length === 0 || definition.pages.length === 0) {
          throw new SurveyError(
            "invalid_definition",
            400,
            "至少需要 1 题 1 页才能发布",
          );
        }
        // 图片选项在发布时必须全部绑定到本问卷的绑定行：快照不可变，带着悬空
        // imageFileId 发布会让公开页永远裂图。
        const imageRefs = collectImageFileIds(definition);
        if (imageRefs.length > 0) {
          const bound = new Set(
            await tx.boundFileIds(
              surveyId,
              imageRefs.map((ref) => ref.fileId),
            ),
          );
          const issues = imageRefs
            .filter((ref) => !bound.has(ref.fileId))
            .map((ref) => ({
              path: `questions.${ref.qi}.options.${ref.oi}.imageFileId`,
              code: "unbound_media",
              message: "选项图片未上传或已被删除，请重新上传后再发布",
            }));
          if (issues.length > 0)
            throw new SurveyError(
              "unbound_media",
              400,
              "存在未绑定的选项图片",
              issues,
            );
        }
        const revision = (await tx.latestRevisionNumber(surveyId)) + 1;
        const created = await tx.insertRevision({
          userId: row.userId,
          teamId: row.teamId,
          surveyId,
          revision,
          definition,
          contentHash: sha256Hex(canonicalJson(definition)),
        });
        await tx.updateSurvey({
          currentRevisionId: created.id,
          // 已暂停/已发布的问卷发布新版本不改采集状态：发布是版本动作，不是开关。
          status: row.status === "draft" ? "published" : row.status,
        });
      });
      return getSurveyDetail(userId, surveyId);
    },

    async setSurveyStatus(
      userId: string,
      surveyId: string,
      input: SetSurveyStatusInput,
    ): Promise<SurveyDetail> {
      await loadSurveyAccess(ports, userId, surveyId, "write");
      await storage.withSurveyLock(surveyId, async (tx) => {
        const row = await tx.survey();
        if (!row || row.deletedAt) throw new SurveyError("not_found", 404);
        if (row.status === input.status) return;
        if (row.status === "closed")
          throw new SurveyError("survey_closed", 409, "问卷已关闭");
        if (input.status !== "closed" && !row.currentRevisionId) {
          throw new SurveyError("not_published", 409, "问卷尚未发布");
        }
        await tx.updateSurvey({ status: input.status });
      });
      return getSurveyDetail(userId, surveyId);
    },

    async deleteSurvey(userId: string, surveyId: string): Promise<void> {
      await loadSurveyAccess(ports, userId, surveyId, "delete");
      const released = await storage.withSurveyLock(surveyId, async (tx) => {
        await tx.updateSurvey({ deletedAt: new Date() });
        await tx.deleteReview(surveyId);
        // 级联清选项图绑定；物理字节回收在锁外按宿主池规则进行，但逐 sha 与
        // 上传路径（put+绑定）互斥——同内容重传不能落进 GC 的检查与删除之间。
        return tx.deleteMediaBindings(surveyId);
      });
      await collectReleasedMedia(ports.media, released.map((r) => r.sha256));
    },

    async listResponses(
      userId: string,
      surveyId: string,
      revisionId?: string | null,
    ): Promise<SurveyResponseView[]> {
      const { survey } = await loadSurveyAccess(ports, userId, surveyId, "read");
      const revision = await requireRevision(surveyId, revisionId, survey.currentRevisionId);
      return (await finishedResponses(surveyId, revision.id)).map(toResponseView);
    },

    async exportResponsesCsv(
      userId: string,
      surveyId: string,
      revisionId?: string | null,
    ): Promise<{ filename: string; csv: string }> {
      const { survey } = await loadSurveyAccess(ports, userId, surveyId, "read");
      const revision = await requireRevision(surveyId, revisionId, survey.currentRevisionId);
      const definition = asDefinition(revision.definitionJson);
      const rows = await finishedResponses(surveyId, revision.id);
      // 展开变量与其单元格值共用 core 的唯一口径；单变量题保持历史列头。
      const groups: Array<{
        question: SurveyDefinition["questions"][number];
        variables: SurveyColumnVariable[];
      }> = definition.questions.map((question) => ({
        question,
        variables: surveyVariablesOf(question),
      }));
      const columns = [
        "response_id",
        "started_at",
        "completed_at",
        "duration_ms",
        ...groups.flatMap(({ question, variables }) =>
          variables.map((variable) =>
            variable.id === question.id
              ? `${question.title} [${question.id}]`
              : `${variable.label} [${variable.id}]`,
          ),
        ),
      ];
      const body = rows.map((row) => {
        const view = toResponseView(row);
        const answers = view.answers;
        return [
          view.id,
          view.startedAt,
          view.completedAt,
          view.durationMs,
          ...groups.flatMap(({ question, variables }) =>
            variables.map((variable) => {
              const value = surveyCellValue(
                question,
                variable.id,
                answers[question.id],
              );
              if (Array.isArray(value)) return JSON.stringify(value);
              return value;
            }),
          ),
        ];
      });
      return {
        filename: `survey-${survey.slug}-v${revision.revision}.csv`,
        csv: buildCsv(columns, body),
      };
    },

    /** 变量字典与定义共用同一不可变 revision，不含任何答卷内容。 */
    async surveyCodebook(
      userId: string,
      surveyId: string,
      revisionId?: string | null,
    ): Promise<SurveyCodebook> {
      const { survey } = await loadSurveyAccess(ports, userId, surveyId, "read");
      const revision = await requireRevision(surveyId, revisionId, survey.currentRevisionId);
      const definition = asDefinition(revision.definitionJson);
      const variables = surveyVariables(definition).map(
        ({ questionId: _questionId, ...variable }) => variable,
      );
      return {
        definition,
        surveyId,
        revisionId: revision.id,
        revision: revision.revision,
        variables,
      };
    },

    // 仅返回当前可读版本的有界原件；来源删除后不可再读取（research-data 只读口）。
    async readSurveyDatasetSource(
      userId: string,
      surveyId: string,
      revisionId: string,
    ): Promise<{
      survey: { id: string; title: string; userId: string; teamId: string | null };
      revision: {
        id: string;
        revision: number;
        definition: SurveyDefinition;
        contentHash: string;
      };
      responses: SurveyResponseView[];
    }> {
      const { survey } = await loadSurveyAccess(ports, userId, surveyId, "read");
      const revision = await requireRevision(surveyId, revisionId, null);
      const responses = (await finishedResponses(surveyId, revision.id)).map(
        toResponseView,
      );
      return {
        survey: {
          id: survey.id,
          title: survey.title,
          userId: survey.userId,
          teamId: survey.teamId,
        },
        revision: {
          id: revision.id,
          revision: revision.revision,
          definition: asDefinition(revision.definitionJson),
          contentHash: revision.contentHash,
        },
        responses,
      };
    },
  };
}

export type SurveysService = ReturnType<typeof createSurveysService>;

/** 公开定义投影：imageFileId 解析成匿名可直连的资产 URL。受访者页面只认
 *  imageUrl，不感知内部绑定行 id 的读取协议。 */
export const PUBLIC_MEDIA_URL_PREFIX = "/api/survey-public/assets";

export function toPublicDefinition(definition: SurveyDefinition): SurveyDefinition {
  const publicDefinition: SurveyDefinition = {
    version: definition.version,
    title: definition.title,
    description: definition.description,
    consent: definition.consent,
    questions: definition.questions,
    pages: definition.pages,
  };
  const hasImage = definition.questions.some(
    (question) =>
      (question.type === "image_single" || question.type === "image_multiple") &&
      question.options.some((option) => option.imageFileId),
  );
  if (!hasImage) return publicDefinition;
  return {
    ...publicDefinition,
    questions: definition.questions.map((question) => {
      if (question.type !== "image_single" && question.type !== "image_multiple")
        return question;
      return {
        ...question,
        options: question.options.map((option) =>
          option.imageFileId
            ? { ...option, imageUrl: `${PUBLIC_MEDIA_URL_PREFIX}/${option.imageFileId}` }
            : option,
        ),
      };
    }),
  };
}

/** 公开页投影（collection 用；不含作者与计数以外的管理信息）。 */
export function toPublicSurvey(
  survey: SurveyRecord,
  revisionId: string,
  definition: SurveyDefinition,
  quotaReached: boolean,
): PublicSurvey {
  return {
    id: survey.id,
    slug: survey.slug,
    status: survey.status as SurveyStatus,
    revisionId,
    definition: toPublicDefinition(definition),
    quotaReached,
  };
}
