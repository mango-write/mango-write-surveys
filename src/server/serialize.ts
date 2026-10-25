// 纯函数层：令牌/哈希/CSV。不碰 DB 与 HTTP，单测直接跑。

import { createHash, randomBytes } from "node:crypto";

import { canonicalSurveyJson } from "../core/index.js";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** 键序无关的稳定序列化：实现唯一来源在 surveys 包 core（web 侧的未发布修改判定
 *  与这里的 contentHash 必须逐字节一致）。 */
export const canonicalJson = canonicalSurveyJson;

/** 会话凭证：服务端 256bit 随机，明文只回给客户端一次。 */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 库里只存哈希：泄库不泄凭证，也防止拿 token 做跨环境重放。 */
export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}

/** 同一凭证的相同答案复用同一 answersHash，用作幂等回执的冲突判据。 */
export function hashAnswers(answers: unknown): string {
  return sha256Hex(canonicalJson(answers));
}

/** 公开链接：128bit URL-safe 随机段，不可枚举也不含作者信息。 */
export function newSurveySlug(): string {
  return randomBytes(16).toString("base64url");
}

export function durationMs(startedAt: Date, completedAt: Date | null): number {
  if (!completedAt) return 0;
  return Math.max(0, completedAt.getTime() - startedAt.getTime());
}

// 文本公式前缀转义，避免双击 CSV 时执行公式；真实数值保留数值语义。
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

/** 列序由调用方的引用快照（某 revision 的定义）决定，不依赖行内键序。 */
export function buildCsv(
  columns: string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>,
): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  // BOM 让中文表头在 Excel 里不乱码；CRLF 是 Excel 对 CSV 的事实默认。
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
