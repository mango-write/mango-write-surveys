// 问卷包与宿主之间的全部服务端边界契约（issue #223 §4）。
// 依赖方向：问卷 → 本文件 ← 宿主 adapter。包拥有业务硬约束（状态机、软删除、
// 终态、乐观锁、幂等回执），宿主 port 拥有身份/生命周期/授权与物理存储——
// 最终判定 = 包内硬约束 ∩ 宿主 port，不存在「内置放行 OR 宿主放行」的合并。
// 宿主特有错误（如主站 WrongTenantError）在包内原样穿透，由宿主 onError 收口。
import type { SurveyDefinition } from "./core/index.js";

// ── 主体与授权 ───────────────────────────────────────────────────────────────

/** 认证后的调用主体与归属空间；身份永不来自请求体。 */
export interface SurveysActor {
  userId: string;
  space: { kind: "personal" } | { kind: "team"; teamId: string };
}

export interface SurveyResourceAccess {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

export interface SurveysSpaceAccess {
  canRead: boolean;
  canWrite: boolean;
}

export interface SurveysAuthPort {
  /** 资源级判定（surveys → 宿主授权引擎）。非成员语义 = canRead false（404）。 */
  resolveResourceAccess(
    userId: string,
    surveyId: string,
  ): Promise<SurveyResourceAccess>;
  /** 空间级判定：所有 actor 的 list/create 都必须先经此闸，宿主个人空间策略在此生效。 */
  resolveSpaceAccess(
    userId: string,
    space: SurveysActor["space"],
  ): Promise<SurveysSpaceAccess>;
  /** 匿名采集准入：作者冻结/注销、团队失效等生命周期链由宿主判定。 */
  isCollectionAllowed(surveyId: string): Promise<boolean>;
  /** 媒体 GET 例外面：<img> 带不了宿主身份头时，按资源归属锁定身份再判定。 */
  runInResourceSpace<T>(teamId: string | null, fn: () => Promise<T>): Promise<T>;
}

// ── 数据记录（包自有形状，宿主 adapter 负责与物理存储互转）──────────────────

export interface SurveyRecord {
  id: string;
  userId: string;
  teamId: string | null;
  title: string;
  slug: string;
  status: string;
  currentRevisionId: string | null;
  draftVersion: number;
  draftJson: unknown;
  completedCount: number;
  responseLimit: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface SurveyRevisionRecord {
  id: string;
  surveyId: string;
  revision: number;
  definitionJson: unknown;
  contentHash: string;
  createdAt: Date;
}

export interface SurveyRevisionMeta {
  id: string;
  revision: number;
  contentHash: string;
  createdAt: Date;
}

export interface SurveyResponseRecord {
  id: string;
  surveyId: string;
  revisionId: string;
  tokenHash: string;
  answersJson: unknown;
  answersHash: string | null;
  finished: boolean;
  startedAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
  consentAcceptedAt: Date | null;
}

export interface SurveyMediaBindingRecord {
  id: string;
  surveyId: string;
  userId: string;
  fileSha256: string;
  name: string;
  createdAt: Date;
}

// ── 事务仓储：状态机的互斥边界都在这里，不退化成无语义 CRUD ────────────────

/**
 * withSurveyLock 内的读写面：宿主实现必须先锁 surveys 行再暴露子行操作
 * （锁序：surveys → revisions/responses/files，与发布/提交/删除共用同一序）。
 */
export interface SurveysLock {
  survey(): Promise<SurveyRecord | null>;
  updateSurvey(patch: {
    title?: string;
    draftJson?: unknown;
    draftVersion?: number;
    responseLimit?: number;
    status?: string;
    currentRevisionId?: string;
    completedCountIncrement?: number;
    deletedAt?: Date;
  }): Promise<void>;
  /** 调用方负责校验返回的 revision 属于当前 survey（跨卷 revisionId 不可借道）。 */
  findRevisionById(id: string): Promise<SurveyRevisionRecord | null>;
  latestRevisionNumber(surveyId: string): Promise<number>;
  insertRevision(input: {
    userId: string;
    teamId: string | null;
    surveyId: string;
    revision: number;
    definition: SurveyDefinition;
    contentHash: string;
  }): Promise<{ id: string }>;
  /** 发布校验：选项图 imageFileId 中已绑定在本问卷的子集。 */
  boundFileIds(surveyId: string, ids: string[]): Promise<string[]>;
  countFinishedResponses(surveyId: string, revisionId: string): Promise<number>;
  findResponseByTokenHash(tokenHash: string): Promise<SurveyResponseRecord | null>;
  createResponse(input: {
    userId: string;
    teamId: string | null;
    surveyId: string;
    revisionId: string;
    tokenHash: string;
    expiresAt: Date;
    consentAcceptedAt: Date;
  }): Promise<void>;
  finishResponse(
    id: string,
    input: { answers: unknown; answersHash: string; completedAt: Date },
  ): Promise<SurveyResponseRecord>;
  /**
   * 删除问卷时级联清绑定行；返回涉及的 (sha256, 绑定数)。宿主可在同一事务内
   * 联动释放自己的引用池（主站 source_files refCount）。
   */
  deleteMediaBindings(surveyId: string): Promise<Array<{ sha256: string; count: number }>>;
}

export interface SurveysStoragePort {
  findById(id: string, opts?: { excludeDeleted?: boolean }): Promise<SurveyRecord | null>;
  findBySlug(slug: string): Promise<SurveyRecord | null>;
  /** 未删除 + 归属（个人 = userId 且 teamId null；团队 = teamId）。 */
  listByOwner(userId: string, teamId: string | null): Promise<SurveyRecord[]>;
  /** slug 冲突由实现内部重试吸收。带 id 时为幂等建卷（AI operationId 派生）：
   *  同 id 已存在必须返回既有行 id（不覆盖、不重试），并发撞 id 不抛错。 */
  create(input: {
    userId: string;
    teamId: string | null;
    title: string;
    definition: SurveyDefinition;
    id?: string;
  }): Promise<{ id: string }>;
  countStarted(surveyId: string): Promise<number>;
  countFinished(surveyId: string, revisionId: string): Promise<number>;
  listRevisions(surveyId: string): Promise<SurveyRevisionMeta[]>;
  findRevisionOfSurvey(
    surveyId: string,
    revisionId: string,
  ): Promise<SurveyRevisionRecord | null>;
  /** 有界读取（take = SURVEY_MAX_RESPONSES+1），超限由 service 判错。 */
  listFinishedResponses(
    surveyId: string,
    revisionId: string,
  ): Promise<
    Array<
      Pick<
        SurveyResponseRecord,
        "id" | "revisionId" | "answersJson" | "startedAt" | "completedAt"
      >
    >
  >;
  findMediaBinding(
    fileId: string,
    surveyId: string,
  ): Promise<{ fileSha256: string } | null>;
  createMediaBinding(input: {
    surveyId: string;
    userId: string;
    fileSha256: string;
    name: string;
  }): Promise<SurveyMediaBindingRecord>;
  /** 公开资产：fileId 有绑定行且被任一已发布快照定义引用 → sha256。 */
  findPublishedAssetSha(fileId: string): Promise<string | null>;
  withSurveyLock<T>(surveyId: string, fn: (tx: SurveysLock) => Promise<T>): Promise<T>;
}

// ── 媒体字节 ────────────────────────────────────────────────────────────────

export interface SurveysMediaPort {
  /** 字节入池（宿主语义：sha256 去重 / 权威 mime / 大小闸已在包内先验）。 */
  put(bytes: Buffer, mime: string): Promise<{ sha256: string; bytes: number; mime: string }>;
  get(sha256: string): Promise<{ buffer: Buffer; mime: string } | null>;
  /** 绑定行级联删除后的字节回收：宿主按自己的池语义决定是否物理删除。 */
  collectAfterRelease(shas: string[]): Promise<void>;
}

// ── 聚合 ────────────────────────────────────────────────────────────────────

export interface SurveysPorts {
  auth: SurveysAuthPort;
  storage: SurveysStoragePort;
  media: SurveysMediaPort;
}
