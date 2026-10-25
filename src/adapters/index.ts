// 独立站 adapters barrel：三 port 实现 + 聚合装配（issue #223 §8）。
import type { SurveysPorts } from "../ports.js";

import { createFsMedia, type FsMediaOptions } from "./fs-media.js";
import {
  createPgStorage,
  initStandaloneSchema,
  runSurveyDdl,
  standaloneDdlSql,
  type StandaloneSurveysStorage,
} from "./pg-storage.js";
import {
  STANDALONE_ADMIN_USER_ID,
  createSimpleAuth,
  standaloneAdminActor,
} from "./simple-auth.js";

export { createPgStorage, initStandaloneSchema, runSurveyDdl, standaloneDdlSql };
export type { StandaloneSurveysStorage };
export { createFsMedia };
export type { FsMediaOptions };
export { STANDALONE_ADMIN_USER_ID, createSimpleAuth, standaloneAdminActor };

export interface StandaloneSurveysConfig {
  databaseUrl: string;
  mediaDir: string;
}

export interface StandaloneSurveysPorts extends SurveysPorts {
  storage: StandaloneSurveysStorage;
}

export function createStandaloneSurveysPorts(
  config: StandaloneSurveysConfig,
): StandaloneSurveysPorts {
  const storage = createPgStorage(config.databaseUrl);
  return {
    auth: createSimpleAuth(storage),
    storage,
    media: createFsMedia({
      dir: config.mediaDir,
      isBound: (sha256) => storage.hasMediaBinding(sha256),
    }),
  };
}
