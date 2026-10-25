// 匿名采集面：公开读取 / 建立会话 / 提交答卷。
//
// 与 service 共用同一锁序：提交在自己的事务里先锁 surveys 行，再动
// survey_responses。于是「同 token 完成唯一」「最后名额不超收」「关闭竞态」都
// 落在数据库互斥上——进程内限流只防刷，不承担正确性。
import { validateSurveyAnswers } from "../core/index.js";
import {
  type PublicSurvey,
  type StartSurveyInput,
  type SubmitSurveyInput,
  type SurveyReceipt,
  type SurveySession,
} from "../contracts/index.js";
import type { SurveysPorts, SurveyRecord, SurveyRevisionRecord } from "../ports.js";

import { SurveyError } from "./errors.js";
import { SURVEY_SESSION_TTL_MS } from "./limits.js";
import { hashAnswers, hashSessionToken, newSessionToken } from "./serialize.js";
import {
  asDefinition,
  toPublicDefinition,
  toPublicSurvey,
} from "./service.js";

/** 蜜罐伪成功用固定零值：结构完整但不指向任何真实行，机器人也拿不到有效回执。 */
const NIL_RECEIPT_ID = "00000000-0000-0000-0000-000000000000";

function fakeReceipt(): SurveyReceipt {
  return {
    responseId: NIL_RECEIPT_ID,
    revisionId: NIL_RECEIPT_ID,
    completedAt: new Date().toISOString(),
  };
}

function receiptOf(row: {
  id: string;
  revisionId: string;
  completedAt: Date | null;
}): SurveyReceipt {
  return {
    responseId: row.id,
    revisionId: row.revisionId,
    completedAt: (row.completedAt ?? new Date(0)).toISOString(),
  };
}

export function createSurveysCollection(ports: SurveysPorts) {
  const { storage, auth } = ports;

  async function loadCollectable(
    slug: string,
  ): Promise<{ survey: SurveyRecord; revision: SurveyRevisionRecord }> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(slug))
      throw new SurveyError("not_found", 404);
    const survey = await storage.findBySlug(slug);
    // 草稿没有发布版本，等同不存在；软删除后整条采集面撤销。
    if (!survey || survey.deletedAt || !survey.currentRevisionId) {
      throw new SurveyError("not_found", 404);
    }
    if (survey.status === "draft") throw new SurveyError("not_found", 404);
    // 作者冻结/注销、团队过期/解散统一由宿主 auth port 判定。
    if (!(await auth.isCollectionAllowed(survey.id)))
      throw new SurveyError("not_found", 404);
    const revision = await storage.findRevisionOfSurvey(
      survey.id,
      survey.currentRevisionId,
    );
    if (!revision) throw new SurveyError("not_found", 404);
    return { survey, revision };
  }

  return {
    loadCollectable,

    async getPublicSurvey(slug: string): Promise<PublicSurvey> {
      const { survey, revision } = await loadCollectable(slug);
      // 名额是否已满按当前采集版本的已完成数计：新会话绑定当前版本，提交时
      // 服务端在同一互斥边界终审；这里只给落地页预提示，不是准入判定。
      const finished = await storage.countFinished(survey.id, revision.id);
      return toPublicSurvey(
        survey,
        revision.id,
        asDefinition(revision.definitionJson),
        finished >= survey.responseLimit,
      );
    },

    /**
     * 建立或恢复会话。恢复只看 resumeToken 指向的那一行：它绑定的 revision 不因
     * 后续发布而改变；过期需用户显式重新开始，不能把旧答案解释为新版本。
     */
    async startSurvey(slug: string, input: StartSurveyInput): Promise<SurveySession> {
      const { survey } = await loadCollectable(slug);
      return storage.withSurveyLock(survey.id, async (tx) => {
        const locked = await tx.survey();
        if (
          !locked ||
          locked.deletedAt ||
          !locked.currentRevisionId ||
          locked.status === "draft"
        ) {
          throw new SurveyError("not_found", 404);
        }
        const now = new Date();
        if (input.resumeToken) {
          const existing = await tx.findResponseByTokenHash(
            hashSessionToken(input.resumeToken),
          );
          if (!existing || existing.surveyId !== locked.id)
            throw new SurveyError("session_not_found", 404);
          if (!existing.finished && existing.expiresAt.getTime() <= now.getTime())
            throw new SurveyError("session_expired", 409);
          const bound = await tx.findRevisionById(existing.revisionId);
          if (!bound) throw new SurveyError("not_found", 404);
          return {
            sessionToken: input.resumeToken,
            revisionId: existing.revisionId,
            definition: toPublicDefinition(asDefinition(bound.definitionJson)),
            expiresAt: existing.expiresAt.toISOString(),
            ...(existing.finished ? { receipt: receiptOf(existing) } : {}),
          };
        }
        if (locked.status !== "published")
          throw new SurveyError("survey_not_accepting", 409);
        const revision = await tx.findRevisionById(locked.currentRevisionId);
        if (!revision) throw new SurveyError("not_found", 404);
        const token = newSessionToken();
        const expiresAt = new Date(now.getTime() + SURVEY_SESSION_TTL_MS);
        await tx.createResponse({
          userId: locked.userId,
          teamId: locked.teamId,
          surveyId: locked.id,
          revisionId: revision.id,
          tokenHash: hashSessionToken(token),
          expiresAt,
          consentAcceptedAt: now,
        });
        return {
          sessionToken: token,
          revisionId: revision.id,
          definition: toPublicDefinition(asDefinition(revision.definitionJson)),
          expiresAt: expiresAt.toISOString(),
        };
      });
    },

    async submitSurvey(slug: string, input: SubmitSurveyInput): Promise<SurveyReceipt> {
      // 蜜罐先于一切查库：机器人拿到伪成功，库里的答卷计数不受影响。
      if (input.honeypot && input.honeypot.trim() !== "") return fakeReceipt();

      const { survey } = await loadCollectable(slug);
      const tokenHash = hashSessionToken(input.sessionToken);
      const answersHash = hashAnswers(input.answers);
      const now = new Date();

      return storage.withSurveyLock(survey.id, async (tx) => {
        const locked = await tx.survey();
        if (!locked || locked.deletedAt || locked.status === "draft") {
          throw new SurveyError("not_found", 404);
        }

        const current = await tx.findResponseByTokenHash(tokenHash);
        if (!current || current.surveyId !== locked.id) {
          throw new SurveyError("session_not_found", 404, "会话不存在");
        }

        // 已完成：相同答案回同一回执（关闭后重试也一样），不同答案明确冲突。
        if (current.finished) {
          if (current.answersHash === answersHash) return receiptOf(current);
          throw new SurveyError(
            "answers_conflict",
            409,
            "该会话已提交过不同的答案",
          );
        }
        if (current.expiresAt.getTime() <= now.getTime()) {
          throw new SurveyError("session_expired", 409, "会话已过期");
        }
        if (locked.status === "closed") {
          throw new SurveyError("survey_closed", 409, "问卷已关闭");
        }

        const revision = await tx.findRevisionById(current.revisionId);
        if (!revision) throw new SurveyError("not_found", 404);
        const issues = validateSurveyAnswers(
          asDefinition(revision.definitionJson),
          input.answers,
        );
        // 服务端不清洗、不静默丢键：路径失效或隐藏答案一律拒绝，让客户端改。
        if (issues.length > 0) {
          throw new SurveyError("invalid_answers", 400, "答案不合法", issues);
        }

        const finished = await tx.countFinishedResponses(
          locked.id,
          current.revisionId,
        );
        if (finished >= locked.responseLimit) {
          throw new SurveyError(
            "response_limit_reached",
            409,
            "该版本答卷已达上限",
          );
        }

        const stored = await tx.finishResponse(current.id, {
          answers: input.answers,
          answersHash,
          completedAt: now,
        });
        await tx.updateSurvey({ completedCountIncrement: 1 });
        return receiptOf(stored);
      });
    },
  };
}

export type SurveysCollection = ReturnType<typeof createSurveysCollection>;
