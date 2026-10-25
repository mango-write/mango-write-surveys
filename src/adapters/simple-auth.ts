// 独立站默认授权 port（issue #223 §8，策略见 §5）：创建者全权、非创建者全拒；
// 空间判定 personal 恒允许、team 恒拒。isCollectionAllowed 只复刻问卷自身
// 「存在且未删」的链路（主站的作者冻结/注销、团队失效语义独立站没有）。
import type { SurveysActor, SurveysAuthPort, SurveysStoragePort } from "../ports.js";

const FULL_RESOURCE_ACCESS = { canRead: true, canWrite: true, canDelete: true };
const NO_RESOURCE_ACCESS = { canRead: false, canWrite: false, canDelete: false };
const FULL_SPACE_ACCESS = { canRead: true, canWrite: true };
const NO_SPACE_ACCESS = { canRead: false, canWrite: false };

export const STANDALONE_ADMIN_USER_ID = "admin";

export function standaloneAdminActor(): SurveysActor {
  return { userId: STANDALONE_ADMIN_USER_ID, space: { kind: "personal" } };
}

export function createSimpleAuth(storage: SurveysStoragePort): SurveysAuthPort {
  return {
    async resolveResourceAccess(userId, surveyId) {
      const survey = await storage.findById(surveyId, { excludeDeleted: true });
      if (!survey) return NO_RESOURCE_ACCESS;
      return survey.userId === userId ? FULL_RESOURCE_ACCESS : NO_RESOURCE_ACCESS;
    },
    // 独立站 DDL（ddl.sql）没有 team 表，team 空间不存在合法成员，恒拒。
    resolveSpaceAccess: async (_userId, space) =>
      space.kind === "personal" ? FULL_SPACE_ACCESS : NO_SPACE_ACCESS,
    async isCollectionAllowed(surveyId) {
      const survey = await storage.findById(surveyId, { excludeDeleted: true });
      return survey !== null;
    },
    runInResourceSpace: (_teamId, fn) => fn(),
  };
}
