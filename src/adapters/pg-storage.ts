// 独立站存储 adapter（issue #223 §8）：postgres.js 直连独立 PostgreSQL，
// 物理列与主仓 paper schema 对齐（ddl.sql）。锁与事务语义照抄主站 adapter：
// withSurveyLock = BEGIN → SELECT … FOR UPDATE → 回调读写 → COMMIT/ROLLBACK。
import { readFile } from "node:fs/promises";

import postgres from "postgres";

import type {
  SurveysLock,
  SurveysStoragePort,
  SurveyMediaBindingRecord,
  SurveyRecord,
  SurveyResponseRecord,
  SurveyRevisionMeta,
  SurveyRevisionRecord,
} from "../ports.js";
import { SURVEY_MAX_RESPONSES } from "../server/limits.js";
import { newSurveySlug } from "../server/serialize.js";

export function standaloneDdlSql(): Promise<string> {
  return readFile(new URL("./ddl.sql", import.meta.url), "utf8");
}

export async function runSurveyDdl(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(await standaloneDdlSql());
}

/** 独立连接跑一次幂等 DDL 后即关闭；启动与 db:init 共用。 */
export async function initStandaloneSchema(databaseUrl: string): Promise<void> {
  // 幂等重跑的 "already exists" NOTICE 是预期噪音，不进日志。
  const sql = postgres(databaseUrl, { onnotice: () => {} });
  try {
    await runSurveyDdl(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

interface SurveyRow {
  id: string;
  user_id: string;
  team_id: string | null;
  title: string;
  slug: string;
  status: string;
  current_revision_id: string | null;
  draft_version: number;
  draft_json: unknown;
  completed_count: number;
  response_limit: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

interface RevisionRow {
  id: string;
  user_id: string;
  team_id: string | null;
  survey_id: string;
  revision: number;
  definition_json: unknown;
  content_hash: string;
  created_at: Date;
}

interface ResponseRow {
  id: string;
  user_id: string;
  team_id: string | null;
  survey_id: string;
  revision_id: string;
  token_hash: string;
  answers_json: unknown;
  answers_hash: string | null;
  finished: boolean;
  started_at: Date;
  completed_at: Date | null;
  expires_at: Date;
  consent_accepted_at: Date | null;
}

interface FileRow {
  id: string;
  survey_id: string;
  user_id: string;
  file_sha256: string;
  name: string;
  created_at: Date;
}

function toSurvey(row: SurveyRow): SurveyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    teamId: row.team_id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    currentRevisionId: row.current_revision_id,
    draftVersion: row.draft_version,
    draftJson: row.draft_json,
    completedCount: row.completed_count,
    responseLimit: row.response_limit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function toRevision(row: RevisionRow): SurveyRevisionRecord {
  return {
    id: row.id,
    surveyId: row.survey_id,
    revision: row.revision,
    definitionJson: row.definition_json,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

function toResponse(row: ResponseRow): SurveyResponseRecord {
  return {
    id: row.id,
    surveyId: row.survey_id,
    revisionId: row.revision_id,
    tokenHash: row.token_hash,
    answersJson: row.answers_json,
    answersHash: row.answers_hash,
    finished: row.finished,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    consentAcceptedAt: row.consent_accepted_at,
  };
}

function toMediaBinding(row: FileRow): SurveyMediaBindingRecord {
  return {
    id: row.id,
    surveyId: row.survey_id,
    userId: row.user_id,
    fileSha256: row.file_sha256,
    name: row.name,
    createdAt: row.created_at,
  };
}

/** 在已有事务上构造 SurveysLock；调用方必须已先锁 surveys 行。 */
function makeLock(tx: postgres.TransactionSql, surveyId: string): SurveysLock {
  return {
    survey: async () => {
      const rows = await tx<SurveyRow[]>`SELECT * FROM surveys WHERE id = ${surveyId}`;
      return rows[0] ? toSurvey(rows[0]) : null;
    },
    async updateSurvey(patch) {
      // 片段按空格拼接：每个条件片段自带尾逗号，updated_at 兜底保证 SET 非空。
      const sets: postgres.Fragment[] = [];
      if (patch.title !== undefined) sets.push(tx`title = ${patch.title},`);
      if (patch.draftJson !== undefined)
        sets.push(tx`draft_json = ${tx.json(patch.draftJson as postgres.JSONValue)},`);
      if (patch.draftVersion !== undefined) sets.push(tx`draft_version = ${patch.draftVersion},`);
      if (patch.responseLimit !== undefined) sets.push(tx`response_limit = ${patch.responseLimit},`);
      if (patch.status !== undefined) sets.push(tx`status = ${patch.status},`);
      if (patch.currentRevisionId !== undefined)
        sets.push(tx`current_revision_id = ${patch.currentRevisionId},`);
      if (patch.completedCountIncrement)
        sets.push(tx`completed_count = completed_count + ${patch.completedCountIncrement},`);
      if (patch.deletedAt !== undefined) sets.push(tx`deleted_at = ${patch.deletedAt},`);
      sets.push(tx`updated_at = now()`);
      await tx`UPDATE surveys SET ${sets} WHERE id = ${surveyId}`;
    },
    findRevisionById: async (id) => {
      const rows = await tx<RevisionRow[]>`SELECT * FROM survey_revisions WHERE id = ${id}`;
      return rows[0] ? toRevision(rows[0]) : null;
    },
    latestRevisionNumber: async (sid) => {
      const rows = await tx<{ n: number }[]>`
        SELECT COALESCE(MAX(revision), 0)::int AS n FROM survey_revisions WHERE survey_id = ${sid}`;
      return rows[0]?.n ?? 0;
    },
    insertRevision: async (input) => {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO survey_revisions (user_id, team_id, survey_id, revision, definition_json, content_hash)
        VALUES (${input.userId}, ${input.teamId}, ${input.surveyId}, ${input.revision},
                ${tx.json(input.definition as postgres.JSONValue)}, ${input.contentHash})
        RETURNING id`;
      return { id: rows[0].id };
    },
    boundFileIds: async (sid, ids) => {
      if (ids.length === 0) return [];
      const rows = await tx<{ id: string }[]>`
        SELECT id FROM survey_files WHERE survey_id = ${sid} AND id IN ${tx(ids)}`;
      return rows.map((row) => row.id);
    },
    countFinishedResponses: async (sid, rid) => {
      const rows = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM survey_responses
        WHERE survey_id = ${sid} AND revision_id = ${rid} AND finished`;
      return rows[0]?.n ?? 0;
    },
    findResponseByTokenHash: async (tokenHash) => {
      const rows = await tx<ResponseRow[]>`SELECT * FROM survey_responses WHERE token_hash = ${tokenHash}`;
      return rows[0] ? toResponse(rows[0]) : null;
    },
    createResponse: async (input) => {
      await tx`
        INSERT INTO survey_responses
          (user_id, team_id, survey_id, revision_id, token_hash, expires_at, consent_accepted_at)
        VALUES (${input.userId}, ${input.teamId}, ${input.surveyId}, ${input.revisionId},
                ${input.tokenHash}, ${input.expiresAt}, ${input.consentAcceptedAt})`;
    },
    finishResponse: async (id, input) => {
      const rows = await tx<ResponseRow[]>`
        UPDATE survey_responses
        SET answers_json = ${tx.json(input.answers as postgres.JSONValue)}, answers_hash = ${input.answersHash},
            finished = true, completed_at = ${input.completedAt}
        WHERE id = ${id}
        RETURNING *`;
      return toResponse(rows[0]);
    },
    async deleteMediaBindings(sid) {
      const rows = await tx<{ file_sha256: string }[]>`
        SELECT file_sha256 FROM survey_files WHERE survey_id = ${sid}`;
      if (rows.length === 0) return [];
      await tx`DELETE FROM survey_files WHERE survey_id = ${sid}`;
      const counts = new Map<string, number>();
      for (const row of rows)
        counts.set(row.file_sha256, (counts.get(row.file_sha256) ?? 0) + 1);
      return [...counts.entries()].map(([sha256, count]) => ({ sha256, count }));
    },
  };
}

export interface StandaloneSurveysStorage extends SurveysStoragePort {
  /** 选项图字节回收前的绑定复查（独立站无 source_files 池，绑定行即引用计数）。 */
  hasMediaBinding(sha256: string): Promise<boolean>;
  close(): Promise<void>;
}

export function createPgStorage(databaseUrl: string): StandaloneSurveysStorage {
  const sql = postgres(databaseUrl);

  return {
    async findById(id, opts) {
      const rows = await sql<SurveyRow[]>`
        SELECT * FROM surveys
        WHERE id = ${id} ${opts?.excludeDeleted ? sql`AND deleted_at IS NULL` : sql``}`;
      return rows[0] ? toSurvey(rows[0]) : null;
    },
    async findBySlug(slug) {
      const rows = await sql<SurveyRow[]>`SELECT * FROM surveys WHERE slug = ${slug}`;
      return rows[0] ? toSurvey(rows[0]) : null;
    },
    async listByOwner(userId, teamId) {
      const rows = await sql<SurveyRow[]>`
        SELECT * FROM surveys
        WHERE deleted_at IS NULL AND
          ${teamId ? sql`team_id = ${teamId}` : sql`(user_id = ${userId} AND team_id IS NULL)`}
        ORDER BY updated_at DESC`;
      return rows.map(toSurvey);
    },
    async create(input) {
      // 幂等建卷：带 id 撞既有行时返回既有 id（不覆盖、不重试）。
      if (input.id) {
        const inserted = await sql<{ id: string }[]>`
          INSERT INTO surveys (id, user_id, team_id, title, slug, draft_json)
          VALUES (${input.id}, ${input.userId}, ${input.teamId}, ${input.title},
                  ${newSurveySlug()}, ${sql.json(input.definition as postgres.JSONValue)})
          ON CONFLICT (id) DO NOTHING
          RETURNING id`;
        if (inserted[0]) return { id: inserted[0].id };
        const existing = await sql<{ id: string }[]>`
          SELECT id FROM surveys WHERE id = ${input.id}`;
        return { id: existing[0]!.id };
      }
      for (let attempt = 0; ; attempt += 1) {
        try {
          const rows = await sql<{ id: string }[]>`
            INSERT INTO surveys (user_id, team_id, title, slug, draft_json)
            VALUES (${input.userId}, ${input.teamId}, ${input.title},
                    ${newSurveySlug()}, ${sql.json(input.definition as postgres.JSONValue)})
            RETURNING id`;
          return { id: rows[0].id };
        } catch (err) {
          // slug 冲突（128bit 随机段）重试吸收，其余抛出。
          if (attempt < 4 && err instanceof postgres.PostgresError && err.code === "23505")
            continue;
          throw err;
        }
      }
    },
    async countStarted(surveyId) {
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM survey_responses WHERE survey_id = ${surveyId}`;
      return rows[0]?.n ?? 0;
    },
    async countFinished(surveyId, revisionId) {
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM survey_responses
        WHERE survey_id = ${surveyId} AND revision_id = ${revisionId} AND finished`;
      return rows[0]?.n ?? 0;
    },
    async listRevisions(surveyId) {
      const rows = await sql<RevisionRow[]>`
        SELECT * FROM survey_revisions WHERE survey_id = ${surveyId} ORDER BY revision DESC`;
      const metas: SurveyRevisionMeta[] = rows.map((row) => ({
        id: row.id,
        revision: row.revision,
        contentHash: row.content_hash,
        createdAt: row.created_at,
      }));
      return metas;
    },
    findRevisionOfSurvey: async (surveyId, revisionId) => {
      const rows = await sql<RevisionRow[]>`
        SELECT * FROM survey_revisions WHERE id = ${revisionId} AND survey_id = ${surveyId}`;
      return rows[0] ? toRevision(rows[0]) : null;
    },
    async listFinishedResponses(surveyId, revisionId) {
      const rows = await sql<
        Array<Pick<ResponseRow, "id" | "revision_id" | "answers_json" | "started_at" | "completed_at">>
      >`
        SELECT id, revision_id, answers_json, started_at, completed_at FROM survey_responses
        WHERE survey_id = ${surveyId} AND revision_id = ${revisionId} AND finished
        ORDER BY completed_at ASC, id ASC
        LIMIT ${SURVEY_MAX_RESPONSES + 1}`;
      return rows.map((row) => ({
        id: row.id,
        revisionId: row.revision_id,
        answersJson: row.answers_json,
        startedAt: row.started_at,
        completedAt: row.completed_at,
      }));
    },
    findMediaBinding: async (fileId, surveyId) => {
      const rows = await sql<Array<Pick<FileRow, "file_sha256">>>`
        SELECT file_sha256 FROM survey_files WHERE id = ${fileId} AND survey_id = ${surveyId}`;
      return rows[0] ? { fileSha256: rows[0].file_sha256 } : null;
    },
    createMediaBinding: async (input) => {
      const rows = await sql<FileRow[]>`
        INSERT INTO survey_files (survey_id, user_id, file_sha256, name)
        VALUES (${input.surveyId}, ${input.userId}, ${input.fileSha256}, ${input.name})
        RETURNING *`;
      return toMediaBinding(rows[0]);
    },
    async findPublishedAssetSha(fileId) {
      // jsonb 包含谓词按嵌套语义匹配 questions[].options[].imageFileId；
      // 绑定行 + 任一已发布快照引用才放行（draftJson 不是快照，冒充不了）。
      // 必须经 sql.json 传参：服务端按 ::jsonb 上下文回推参数类型后，
      // postgres.js 会对字符串参数做 JSON.stringify，裸字符串会被二次编码。
      const needle = sql.json({
        questions: [{ options: [{ imageFileId: fileId }] }],
      });
      const rows = await sql<{ file_sha256: string }[]>`
        SELECT sf.file_sha256
        FROM survey_files sf
        JOIN surveys s ON s.id = sf.survey_id AND s.deleted_at IS NULL
        JOIN survey_revisions r ON r.survey_id = sf.survey_id
        WHERE sf.id = ${fileId}::uuid AND r.definition_json @> ${needle}
        LIMIT 1`;
      return rows[0]?.file_sha256 ?? null;
    },
    async withSurveyLock<T>(surveyId: string, fn: (tx: SurveysLock) => Promise<T>): Promise<T> {
      // 锁序：surveys → revisions/responses/files（与发布/提交/删除共用）。
      // begin 的 UnwrapPromiseArray 对泛型 T 做不出恒等证明，显式收窄。
      return sql.begin(async (tx) => {
        await tx`SELECT id FROM surveys WHERE id = ${surveyId} FOR UPDATE`;
        return fn(makeLock(tx, surveyId));
      }) as Promise<T>;
    },
    async hasMediaBinding(sha256) {
      const rows = await sql<{ present: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM survey_files WHERE file_sha256 = ${sha256}) AS present`;
      return rows[0]?.present ?? false;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
