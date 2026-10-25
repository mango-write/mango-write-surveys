-- 独立站 PostgreSQL 初始化 DDL（issue #223 §8）：仅问卷 4 张表，物理列与主仓
-- paper schema 对齐（packages/db/prisma/schema.prisma），便于两站数据互迁。
-- 幂等：全部 CREATE ... IF NOT EXISTS，可重复执行；要求 PG 13+（内置 gen_random_uuid）。
-- 无外键（与主仓 relationMode="prisma" 风格一致），引用完整性由应用层维护。

CREATE TABLE IF NOT EXISTS surveys (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL,
  team_id             uuid,
  title               text NOT NULL,
  draft_json          jsonb NOT NULL,
  draft_version       integer NOT NULL DEFAULT 1,
  status              text NOT NULL DEFAULT 'draft',
  slug                text NOT NULL,
  current_revision_id uuid,
  response_limit      integer NOT NULL DEFAULT 5000,
  completed_count     integer NOT NULL DEFAULT 0,
  created_at          timestamptz(6) NOT NULL DEFAULT now(),
  updated_at          timestamptz(6) NOT NULL DEFAULT now(),
  deleted_at          timestamptz(6)
);

CREATE UNIQUE INDEX IF NOT EXISTS surveys_slug_key
  ON surveys (slug);
CREATE INDEX IF NOT EXISTS surveys_user_id_team_id_deleted_at_updated_at_idx
  ON surveys (user_id, team_id, deleted_at, updated_at);
CREATE INDEX IF NOT EXISTS surveys_team_id_deleted_at_updated_at_idx
  ON surveys (team_id, deleted_at, updated_at);

CREATE TABLE IF NOT EXISTS survey_revisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL,
  team_id         uuid,
  survey_id       uuid NOT NULL,
  revision        integer NOT NULL,
  definition_json jsonb NOT NULL,
  content_hash    text NOT NULL,
  created_at      timestamptz(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS survey_revisions_survey_id_revision_key
  ON survey_revisions (survey_id, revision);
CREATE INDEX IF NOT EXISTS survey_revisions_user_id_team_id_idx
  ON survey_revisions (user_id, team_id);

CREATE TABLE IF NOT EXISTS survey_responses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            text NOT NULL,
  team_id            uuid,
  survey_id          uuid NOT NULL,
  revision_id        uuid NOT NULL,
  token_hash         text NOT NULL,
  answers_json       jsonb NOT NULL DEFAULT '{}',
  answers_hash       text,
  finished           boolean NOT NULL DEFAULT false,
  started_at         timestamptz(6) NOT NULL DEFAULT now(),
  completed_at       timestamptz(6),
  expires_at         timestamptz(6) NOT NULL,
  consent_accepted_at timestamptz(6) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS survey_responses_token_hash_key
  ON survey_responses (token_hash);
CREATE INDEX IF NOT EXISTS survey_responses_survey_id_revision_id_finished_started_at_idx
  ON survey_responses (survey_id, revision_id, finished, started_at);
CREATE INDEX IF NOT EXISTS survey_responses_user_id_team_id_idx
  ON survey_responses (user_id, team_id);
CREATE INDEX IF NOT EXISTS survey_responses_finished_expires_at_idx
  ON survey_responses (finished, expires_at);

CREATE TABLE IF NOT EXISTS survey_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id   uuid NOT NULL,
  user_id     text NOT NULL,
  file_sha256 text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS survey_files_survey_idx
  ON survey_files (survey_id);
CREATE INDEX IF NOT EXISTS survey_files_sha_idx
  ON survey_files (file_sha256);
