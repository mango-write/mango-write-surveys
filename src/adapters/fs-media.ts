// 独立站媒体 adapter：媒体目录按 sha256 分桶（<dir>/ab/<sha256>），
// mime 权威值存旁文件 <dir>/ab/<sha256>.mime（put 时写、get 时读）。
// 绑定行归 storage port，这里只管字节：put 去重、get 读回、释放后物理回收。
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import type { SurveysMediaPort } from "../ports.js";

export interface FsMediaOptions {
  dir: string;
  /** 返回 true 表示仍有绑定行、跳过物理删除；缺省一律视为已释放。 */
  isBound?: (sha256: string) => Promise<boolean>;
}

const SHA_RE = /^[0-9a-f]{64}$/i;

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

export function createFsMedia(options: FsMediaOptions): SurveysMediaPort {
  const { dir, isBound } = options;
  const fileOf = (sha256: string) => `${dir}/${sha256.slice(0, 2)}/${sha256}`;
  const mimeOf = (sha256: string) => `${fileOf(sha256)}.mime`;

  return {
    async put(bytes, mime) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const bucket = `${dir}/${sha256.slice(0, 2)}`;
      await mkdir(bucket, { recursive: true });
      // 字节按内容寻址，已存在即跳过写入；mime 旁文件只在缺失时补写。
      if (!(await stat(fileOf(sha256)).then(() => true).catch(() => false)))
        await writeFile(fileOf(sha256), bytes);
      if (!(await stat(mimeOf(sha256)).then(() => true).catch(() => false)))
        await writeFile(mimeOf(sha256), mime, "utf8");
      return { sha256, bytes: bytes.length, mime };
    },
    async get(sha256) {
      if (!SHA_RE.test(sha256)) return null;
      try {
        const buffer = await readFile(fileOf(sha256));
        // 字节仍在就照常服务；旁文件丢失不拦读，回落 octet-stream。
        const mime = await readFile(mimeOf(sha256), "utf8").catch(
          () => "application/octet-stream",
        );
        return { buffer, mime };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async collectAfterRelease(shas) {
      for (const sha256 of shas) {
        if (!SHA_RE.test(sha256)) continue;
        if (isBound && (await isBound(sha256))) continue;
        await rm(fileOf(sha256), { force: true });
        await rm(mimeOf(sha256), { force: true });
      }
    },
  };
}
