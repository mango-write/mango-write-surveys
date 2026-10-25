// 独立站 adapters 冒烟：在 5433 测试 PG 服务器上自建 mango_surveys_test（跑前
// DROP/CREATE、跑后 DROP），验证 DDL + 存储契约 + 媒体/授权装配的最小语义。
// 未配置数据库时整组可见跳过；已配置但不可达直接红——CI 配了库就必须真跑，
// 不允许静默滑过去。
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SurveyDefinition } from "../core/index.js";
import { SURVEY_MAX_RESPONSES } from "../server/limits.js";
import { createStandaloneSurveysPorts, initStandaloneSchema } from "./index.js";

const TEST_DB = "mango_surveys_test";

function serverUrl(): string {
  const raw = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  if (!raw) return "";
  const url = new URL(raw);
  url.pathname = "/postgres";
  return url.toString();
}

function databaseUrl(): string {
  const url = new URL(serverUrl());
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

async function reachable(): Promise<boolean> {
  if (!serverUrl()) return false;
  const sql = postgres(serverUrl(), { max: 1, connect_timeout: 3 });
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

const dbConfigured = Boolean(serverUrl());
const dbReachable = await reachable();
if (dbConfigured && !dbReachable) {
  throw new Error(
    "TEST_DATABASE_URL/DATABASE_URL 已配置但连不上——配置了库就必须真跑，不允许整组静默跳过",
  );
}
const suite = dbReachable ? describe : describe.skip;

function definition(title: string): SurveyDefinition {
  return { version: 1, title, description: "", consent: "", questions: [], pages: [] };
}

suite(`surveys standalone adapters (DB)`, () => {
  let admin: postgres.Sql;
  let ports: ReturnType<typeof createStandaloneSurveysPorts>;
  let mediaRoot = "";

  beforeAll(async () => {
    admin = postgres(serverUrl(), { max: 1 });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
    mediaRoot = await mkdtemp(path.join(tmpdir(), "surveys-media-"));
    await initStandaloneSchema(databaseUrl());
    ports = createStandaloneSurveysPorts({ databaseUrl: databaseUrl(), mediaDir: mediaRoot });
  });

  afterAll(async () => {
    await ports.storage.close();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.end({ timeout: 5 });
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  it("create / findById / findBySlug / listByOwner roundtrip", async () => {
    const created = await ports.storage.create({
      userId: "admin",
      teamId: null,
      title: "冒烟问卷",
      definition: definition("冒烟问卷"),
    });
    const row = await ports.storage.findById(created.id);
    expect(row?.title).toBe("冒烟问卷");
    expect(row?.slug).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(row?.status).toBe("draft");
    expect(row?.draftJson).toEqual(definition("冒烟问卷"));
    expect((await ports.storage.findBySlug(row!.slug))?.id).toBe(created.id);
    expect(
      (await ports.storage.findById(created.id, { excludeDeleted: true }))?.id,
    ).toBe(created.id);
    const owned = await ports.storage.listByOwner("admin", null);
    expect(owned.map((survey) => survey.id)).toContain(created.id);
    expect(await ports.storage.listByOwner("someone-else", null)).toEqual([]);
  });

  it("withSurveyLock serializes concurrent sections and exposes the lock read/write face", async () => {
    const { id } = await ports.storage.create({
      userId: "admin",
      teamId: null,
      title: "锁互斥",
      definition: definition("锁互斥"),
    });
    let inside = 0;
    let overlapped = false;
    const section = () =>
      ports.storage.withSurveyLock(id, async () => {
        inside += 1;
        if (inside > 1) overlapped = true;
        await new Promise((resolve) => setTimeout(resolve, 60));
        inside -= 1;
      });
    await Promise.all([section(), section()]);
    expect(overlapped).toBe(false);

    await ports.storage.withSurveyLock(id, async (tx) => {
      expect((await tx.survey())?.status).toBe("draft");
      const revision = (await tx.latestRevisionNumber(id)) + 1;
      expect(revision).toBe(1);
      const created = await tx.insertRevision({
        userId: "admin",
        teamId: null,
        surveyId: id,
        revision,
        definition: definition("锁互斥"),
        contentHash: "hash-1",
      });
      await tx.updateSurvey({
        status: "published",
        currentRevisionId: created.id,
        completedCountIncrement: 2,
      });
      expect((await tx.countFinishedResponses(id, created.id))).toBe(0);
      expect(await tx.boundFileIds(id, [randomUUID()])).toEqual([]);
    });
    const after = await ports.storage.findById(id);
    expect(after?.status).toBe("published");
    expect(after?.completedCount).toBe(2);
    expect(typeof after?.currentRevisionId).toBe("string");
    expect((await ports.storage.listRevisions(id)).map((r) => r.revision)).toEqual([1]);
    expect(
      (await ports.storage.findRevisionOfSurvey(id, after!.currentRevisionId!))?.revision,
    ).toBe(1);
  });

  it("listFinishedResponses returns SURVEY_MAX_RESPONSES+1 bounded rows", async () => {
    const { id: surveyId } = await ports.storage.create({
      userId: "admin",
      teamId: null,
      title: "上限",
      definition: definition("上限"),
    });
    const revisionId = randomUUID();
    const base = Date.now();
    const rows = Array.from({ length: SURVEY_MAX_RESPONSES + 1 }, (_, i) => ({
      user_id: "admin",
      team_id: null,
      survey_id: surveyId,
      revision_id: revisionId,
      token_hash: `tok-${surveyId}-${i}`,
      finished: true,
      completed_at: new Date(base + i * 1000),
      expires_at: new Date(base + 86400_000),
      consent_accepted_at: new Date(base),
      answers_json: { q1: `a${i}` },
    }));
    const sql = postgres(databaseUrl(), { max: 1 });
    try {
      for (let i = 0; i < rows.length; i += 500) {
        await sql`insert into survey_responses ${sql(rows.slice(i, i + 500))}`;
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
    const finished = await ports.storage.listFinishedResponses(surveyId, revisionId);
    expect(finished.length).toBe(SURVEY_MAX_RESPONSES + 1);
    expect(finished[0].answersJson).toEqual({ q1: "a0" });
    expect(finished[0].completedAt!.getTime()).toBeLessThan(
      finished[1].completedAt!.getTime(),
    );
    expect(await ports.storage.countFinished(surveyId, revisionId)).toBe(
      SURVEY_MAX_RESPONSES + 1,
    );
    expect(await ports.storage.countStarted(surveyId)).toBe(SURVEY_MAX_RESPONSES + 1);
  });

  it("findPublishedAssetSha requires binding row + published snapshot + live survey", async () => {
    const { id: surveyId } = await ports.storage.create({
      userId: "admin",
      teamId: null,
      title: "资产放行",
      definition: definition("资产放行"),
    });
    const shaX = (await ports.media.put(Buffer.from("asset-x"), "image/png")).sha256;
    const shaY = (await ports.media.put(Buffer.from("asset-y"), "image/png")).sha256;
    const fileX = await ports.storage.createMediaBinding({
      surveyId,
      userId: "admin",
      fileSha256: shaX,
      name: "x.png",
    });
    const fileY = await ports.storage.createMediaBinding({
      surveyId,
      userId: "admin",
      fileSha256: shaY,
      name: "y.png",
    });
    // 未发布：draftJson 引用也不放行（发布校验只认快照）。
    expect(await ports.storage.findPublishedAssetSha(fileX.id)).toBeNull();
    expect(await ports.storage.findPublishedAssetSha(randomUUID())).toBeNull();

    await ports.storage.withSurveyLock(surveyId, async (tx) => {
      const created = await tx.insertRevision({
        userId: "admin",
        teamId: null,
        surveyId,
        revision: 1,
        definition: {
          questions: [{ type: "image_single", options: [{ id: "o1", imageFileId: fileX.id }] }],
        } as unknown as SurveyDefinition,
        contentHash: "hash-asset",
      });
      await tx.updateSurvey({ currentRevisionId: created.id, status: "published" });
    });
    expect(await ports.storage.findPublishedAssetSha(fileX.id)).toBe(shaX);
    // 有绑定行但没进任何快照：不放行。
    expect(await ports.storage.findPublishedAssetSha(fileY.id)).toBeNull();

    await ports.storage.withSurveyLock(surveyId, async (tx) => {
      await tx.updateSurvey({ deletedAt: new Date() });
    });
    expect(await ports.storage.findPublishedAssetSha(fileX.id)).toBeNull();
  });

  it("fs-media dedupes bytes and collects only after bindings clear", async () => {
    const bytes = Buffer.from("png-bytes-0123456789");
    const first = await ports.media.put(bytes, "image/png");
    const again = await ports.media.put(bytes, "image/png");
    expect(again.sha256).toBe(first.sha256);
    const got = await ports.media.get(first.sha256);
    expect(got?.mime).toBe("image/png");
    expect(got?.buffer.equals(bytes)).toBe(true);
    expect(await ports.media.get("f".repeat(64))).toBeNull();

    const { id: surveyId } = await ports.storage.create({
      userId: "admin",
      teamId: null,
      title: "媒体回收",
      definition: definition("媒体回收"),
    });
    await ports.storage.createMediaBinding({
      surveyId,
      userId: "admin",
      fileSha256: first.sha256,
      name: "a.png",
    });
    await ports.media.collectAfterRelease([first.sha256]);
    expect((await ports.media.get(first.sha256))?.buffer.equals(bytes)).toBe(true);

    await ports.storage.withSurveyLock(surveyId, async (tx) => {
      await tx.deleteMediaBindings(surveyId);
    });
    await ports.media.collectAfterRelease([first.sha256]);
    expect(await ports.media.get(first.sha256)).toBeNull();
  });

  it("simple-auth grants the admin everything and gates collection on survey liveness", async () => {
    const { id } = await ports.storage.create({
      userId: "admin",
      teamId: null,
      title: "授权",
      definition: definition("授权"),
    });
    expect(await ports.auth.resolveResourceAccess("admin", id)).toEqual({
      canRead: true,
      canWrite: true,
      canDelete: true,
    });
    // 创建者策略（#223 review）：创建者本人全权，personal 空间允许；
    // team 空间独立站没有表，恒拒。
    expect(
      await ports.auth.resolveResourceAccess("other-user", id),
    ).toEqual({
      canRead: false,
      canWrite: false,
      canDelete: false,
    });
    expect(await ports.auth.resolveSpaceAccess("admin", { kind: "personal" })).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(await ports.auth.resolveSpaceAccess("admin", { kind: "team", teamId: randomUUID() })).toEqual({
      canRead: false,
      canWrite: false,
    });
    expect(await ports.auth.isCollectionAllowed(id)).toBe(true);
    expect(await ports.auth.isCollectionAllowed(randomUUID())).toBe(false);
    await expect(
      ports.auth.runInResourceSpace(randomUUID(), async () => "ok"),
    ).resolves.toBe("ok");

    await ports.storage.withSurveyLock(id, async (tx) => {
      await tx.updateSurvey({ deletedAt: new Date() });
    });
    expect(await ports.auth.isCollectionAllowed(id)).toBe(false);
  });
});
