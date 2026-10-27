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
import type {
  ResearchDatasetRecord,
  ResearchRunRecord,
  ResearchStoragePort,
} from "../research/types.js";
import type {
  ResearchColumnMapping,
  SurveyResearchRecipe,
  SurveyResearchResult,
  ResearchSource,
} from "../contracts/index.js";
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

interface ReviewRow {
  id: string;
  survey_id: string;
  operation_id: string;
  base_draft_version: number;
  summary: string;
  findings_json: unknown;
  created_at: Date;
  updated_at: Date;
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

function toReview(row: ReviewRow) {
  return {
    id: row.id,
    surveyId: row.survey_id,
    operationId: row.operation_id,
    baseDraftVersion: row.base_draft_version,
    summary: row.summary,
    findingsJson: row.findings_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    review: async () => {
      const rows = await tx<ReviewRow[]>`SELECT * FROM survey_reviews WHERE survey_id = ${surveyId}`;
      return rows[0] ? toReview(rows[0]) : null;
    },
    upsertReview: async (input) => {
      await tx`
        INSERT INTO survey_reviews
          (user_id, team_id, survey_id, operation_id, base_draft_version, summary, findings_json)
        VALUES (${input.userId}, ${input.teamId}, ${surveyId}, ${input.operationId},
                ${input.baseDraftVersion}, ${input.summary}, ${tx.json(input.findings as postgres.JSONValue)})
        ON CONFLICT (survey_id) DO UPDATE SET
          operation_id = EXCLUDED.operation_id,
          base_draft_version = EXCLUDED.base_draft_version,
          summary = EXCLUDED.summary,
          findings_json = EXCLUDED.findings_json,
          updated_at = now()`;
    },
    updateReview: async (sid, patch) => {
      await tx`UPDATE survey_reviews SET
        findings_json = ${tx.json(patch.findings as postgres.JSONValue)},
        base_draft_version = COALESCE(${patch.baseDraftVersion ?? null}, base_draft_version),
        updated_at = now()
        WHERE survey_id = ${sid}`;
    },
    deleteReview: async (sid) => {
      await tx`DELETE FROM survey_reviews WHERE survey_id = ${sid}`;
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

interface ResearchDatasetRow {
  id: string;
  survey_id: string;
  revision_id: string;
  name: string;
  source_json: ResearchSource;
  source_sha256: string;
  parser_version: string;
  row_count: number;
  duplicate_row_count: number;
  mapping_json: ResearchColumnMapping[];
  columns_json: string[];
  normalized_rows_json: Array<Record<string, number | null>>;
  normalized_row_hashes_json: string[];
  rows_hash: string;
  input_hash: string;
  created_at: Date;
}

interface ResearchRunRow {
  id: string;
  survey_id: string;
  revision_id: string;
  dataset_id: string;
  source_kind: "public" | "synthetic";
  source_sha256: string;
  recipe_json: SurveyResearchRecipe;
  engine_version: string;
  input_hash: string;
  result_hash: string;
  result_json: SurveyResearchResult;
  created_at: Date;
}

function toResearchDataset(row: ResearchDatasetRow): ResearchDatasetRecord {
  return {
    id: row.id,
    surveyId: row.survey_id,
    revisionId: row.revision_id,
    name: row.name,
    source: row.source_json,
    sourceSha256: row.source_sha256,
    parserVersion: row.parser_version,
    rowCount: row.row_count,
    duplicateRowCount: row.duplicate_row_count,
    mapping: row.mapping_json,
    columns: row.columns_json,
    normalizedRows: row.normalized_rows_json,
    normalizedRowHashes: row.normalized_row_hashes_json,
    rowsHash: row.rows_hash,
    inputHash: row.input_hash,
    createdAt: row.created_at,
  };
}

function toResearchRun(row: ResearchRunRow): ResearchRunRecord {
  return {
    id: row.id,
    surveyId: row.survey_id,
    revisionId: row.revision_id,
    datasetId: row.dataset_id,
    sourceKind: row.source_kind,
    sourceSha256: row.source_sha256,
    recipe: row.recipe_json,
    engineVersion: row.engine_version,
    inputHash: row.input_hash,
    resultHash: row.result_hash,
    result: row.result_json,
    createdAt: row.created_at,
  };
}

export interface StandaloneSurveysStorage extends SurveysStoragePort, ResearchStoragePort {
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
        definition: row.definition_json,
        createdAt: row.created_at,
      }));
      return metas;
    },
    findReview: async (surveyId) => {
      const rows = await sql<ReviewRow[]>`SELECT * FROM survey_reviews WHERE survey_id = ${surveyId}`;
      return rows[0] ? toReview(rows[0]) : null;
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
    async findResearchDatasetByInput(surveyId, revisionId, inputHash) {
      const rows = await sql<ResearchDatasetRow[]>`
        SELECT * FROM survey_research_datasets
        WHERE survey_id = ${surveyId} AND revision_id = ${revisionId} AND input_hash = ${inputHash}`;
      return rows[0] ? toResearchDataset(rows[0]) : null;
    },
    async findResearchDataset(surveyId, datasetId) {
      const rows = await sql<ResearchDatasetRow[]>`
        SELECT * FROM survey_research_datasets WHERE survey_id = ${surveyId} AND id = ${datasetId}`;
      return rows[0] ? toResearchDataset(rows[0]) : null;
    },
    async listResearchDatasets(surveyId) {
      const rows = await sql<ResearchDatasetRow[]>`
        SELECT * FROM survey_research_datasets WHERE survey_id = ${surveyId} ORDER BY created_at DESC, id`;
      return rows.map(toResearchDataset);
    },
    async insertResearchDataset(record) {
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO survey_research_datasets
          (id, survey_id, revision_id, name, source_json, source_sha256, parser_version, row_count,
           duplicate_row_count, mapping_json, columns_json, normalized_rows_json, normalized_row_hashes_json,
           rows_hash, input_hash, created_at)
        VALUES (${record.id}, ${record.surveyId}, ${record.revisionId}, ${record.name},
          ${sql.json(record.source as postgres.JSONValue)}, ${record.sourceSha256}, ${record.parserVersion},
          ${record.rowCount}, ${record.duplicateRowCount}, ${sql.json(record.mapping as postgres.JSONValue)},
          ${sql.json(record.columns as postgres.JSONValue)}, ${sql.json(record.normalizedRows as postgres.JSONValue)},
          ${sql.json(record.normalizedRowHashes as postgres.JSONValue)}, ${record.rowsHash}, ${record.inputHash}, ${record.createdAt})
        ON CONFLICT (survey_id, revision_id, input_hash) DO NOTHING RETURNING id`;
      if (inserted[0]) return record;
      return (await this.findResearchDatasetByInput(record.surveyId, record.revisionId, record.inputHash))!;
    },
    async findResearchRunByInput(surveyId, inputHash) {
      const rows = await sql<ResearchRunRow[]>`
        SELECT * FROM survey_research_runs WHERE survey_id = ${surveyId} AND input_hash = ${inputHash}`;
      return rows[0] ? toResearchRun(rows[0]) : null;
    },
    async findResearchRun(surveyId, runId) {
      const rows = await sql<ResearchRunRow[]>`
        SELECT * FROM survey_research_runs WHERE survey_id = ${surveyId} AND id = ${runId}`;
      return rows[0] ? toResearchRun(rows[0]) : null;
    },
    async listResearchRuns(surveyId) {
      const rows = await sql<ResearchRunRow[]>`
        SELECT * FROM survey_research_runs WHERE survey_id = ${surveyId} ORDER BY created_at DESC, id`;
      return rows.map(toResearchRun);
    },
    async insertResearchRun(record) {
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO survey_research_runs
          (id, survey_id, revision_id, dataset_id, source_kind, source_sha256, recipe_json,
           engine_version, input_hash, result_hash, result_json, created_at)
        VALUES (${record.id}, ${record.surveyId}, ${record.revisionId}, ${record.datasetId},
          ${record.sourceKind}, ${record.sourceSha256}, ${sql.json(record.recipe as postgres.JSONValue)},
          ${record.engineVersion}, ${record.inputHash}, ${record.resultHash},
          ${sql.json(record.result as postgres.JSONValue)}, ${record.createdAt})
        ON CONFLICT (survey_id, input_hash) DO NOTHING RETURNING id`;
      if (inserted[0]) return record;
      return (await this.findResearchRunByInput(record.surveyId, record.inputHash))!;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
