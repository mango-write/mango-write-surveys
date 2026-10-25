// 媒体 sha 互斥的确定性竞态测试（#223 review P1）：上传（put+绑定入库）与
// 释放回收（isBound 检查+物理删除）必须完整串行。两种交错各钉一条：
// GC 等待在途上传、上传等待在途 GC——后者正是「同内容重传落进 GC 判定与
// 删除之间，留下有绑定无字节」的原始缺陷序列。
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFsMedia } from "../adapters/fs-media.js";
import type {
  SurveysPorts,
  SurveyMediaBindingRecord,
  SurveyRecord,
} from "../ports.js";
import { collectReleasedMedia, withMediaShaLock } from "./media-lock.js";
import { createSurveysMedia } from "./media.js";

// 1×1 PNG（魔数合法，过嗅探）。
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => (resolve = res));
  return { promise, resolve };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function surveyRecord(id: string): SurveyRecord {
  const now = new Date();
  return {
    id,
    userId: "admin",
    teamId: null,
    title: "t",
    slug: `slug-${id.slice(0, 12)}`,
    status: "draft",
    currentRevisionId: null,
    draftVersion: 1,
    draftJson: {},
    completedCount: 0,
    responseLimit: 100,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

describe("media sha lock (upload vs GC)", () => {
  let dir: string;
  let bindings: SurveyMediaBindingRecord[];
  let bindGate: { promise: Promise<void>; resolve: () => void } | null;
  let isBoundPause: Promise<unknown> | null;
  let isBoundCalls: number;
  let ports: SurveysPorts;

  beforeEach(() => {
    return Promise.resolve().then(async () => {
      dir = await mkdtemp(join(tmpdir(), "surveys-media-lock-"));
      bindings = [];
      bindGate = null;
      isBoundPause = null;
      isBoundCalls = 0;
      const media = createFsMedia({
        dir,
        isBound: async (sha256) => {
          isBoundCalls += 1;
          if (isBoundPause) await isBoundPause;
          return bindings.some((row) => row.fileSha256 === sha256);
        },
      });
      ports = {
        media,
        auth: {
          resolveResourceAccess: async () => ({
            canRead: true,
            canWrite: true,
            canDelete: true,
          }),
          resolveSpaceAccess: async () => ({ canRead: true, canWrite: true }),
          isCollectionAllowed: async () => true,
          runInResourceSpace: (_teamId: string | null, fn: () => Promise<unknown>) => fn(),
        },
        storage: {
          findById: async (id: string) =>
            UUID_OK.test(id) ? surveyRecord(id) : null,
          createMediaBinding: async (input: {
            surveyId: string;
            userId: string;
            fileSha256: string;
            name: string;
          }) => {
            if (bindGate) await bindGate.promise;
            const row: SurveyMediaBindingRecord = {
              id: randomUUID(),
              ...input,
              createdAt: new Date(),
            };
            bindings.push(row);
            return row;
          },
        },
      } as unknown as SurveysPorts;
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("GC 等待在途上传：绑定入库后 isBound 看到绑定，字节不被删", async () => {
    const mediaService = createSurveysMedia(ports);
    const sha = (await ports.media.put(PNG_BYTES, "image/png")).sha256;
    const surveyB = randomUUID();
    const gate = deferred();
    bindGate = gate;

    const upload = mediaService.uploadSurveyMedia("admin", surveyB, {
      buffer: PNG_BYTES,
      mime: "image/png",
      filename: "dot.png",
    });
    await tick();
    expect(bindings).toHaveLength(0);

    const release = collectReleasedMedia(ports.media, [sha]);
    await tick();
    // 上传持有锁：GC 的绑定检查尚未发生。
    expect(isBoundCalls).toBe(0);

    gate.resolve();
    await upload;
    await release;
    expect(isBoundCalls).toBe(1);
    expect(bindings).toHaveLength(1);
    // 不变量：绑定存在 ⟹ 字节可读。
    expect(await ports.media.get(sha)).not.toBeNull();
  });

  it("上传等待在途 GC：GC 删完旧字节后 put 重写，新绑定仍有字节", async () => {
    const sha = (await ports.media.put(PNG_BYTES, "image/png")).sha256;
    const surveyA = randomUUID();
    const surveyB = randomUUID();
    // 旧问卷的绑定已随删除事务清掉（此处直接不预置），GC 判定悬停在 isBound。
    bindings = [];
    const gate = deferred();
    isBoundPause = gate.promise;

    const release = collectReleasedMedia(ports.media, [sha]);
    await tick();
    expect(isBoundCalls).toBe(1);

    const mediaService = createSurveysMedia(ports);
    const upload = mediaService.uploadSurveyMedia("admin", surveyB, {
      buffer: PNG_BYTES,
      mime: "image/png",
      filename: "dot.png",
    });
    await tick();
    // GC 持有锁：上传的绑定尚未入库（修复前此刻已入库，随后被 GC 删字节）。
    expect(bindings).toHaveLength(0);

    gate.resolve();
    await release;
    await upload;
    expect(bindings).toHaveLength(1);
    // review 复现的缺陷断言：修复前 newBindingExists=true 且 bytesExist=false。
    expect(await ports.media.get(sha)).not.toBeNull();
  });

  it("锁内失败不阻塞后续同 sha 操作", async () => {
    const boom = withMediaShaLock("ab".repeat(32), async () => {
      throw new Error("boom");
    });
    await expect(boom).rejects.toThrow("boom");
    await expect(
      withMediaShaLock("ab".repeat(32), async () => "ok"),
    ).resolves.toBe("ok");
  });
});

const UUID_OK =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
