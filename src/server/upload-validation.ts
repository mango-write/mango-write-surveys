// 问卷选项图上传校验：字节嗅探白名单仅图片、SVG 净化后落库。
// 自 apps/api/src/lib/upload-validation.ts 的图片子集 vendored（#223 拆包）：
// 嗅探/净化逻辑与主仓同源，主仓侧改动须同步此处——两处都是安全面。
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

export type InvalidUploadReason = "empty" | "too_large" | "unsupported_type";

export class InvalidUploadError extends Error {
  constructor(
    public readonly reason: InvalidUploadReason,
    message: string,
    public readonly sniffedMime: string | null = null,
  ) {
    super(message);
    this.name = "InvalidUploadError";
  }
}

export type SurveyImageMime =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/svg+xml";

export const SURVEY_IMAGE_MIMES: readonly SurveyImageMime[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

const MIME_EXTENSIONS: Record<SurveyImageMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** SVG 是文本档，单独收紧上限，控制净化与解析成本。 */
const SVG_MAX_BYTES = 5 * 1024 * 1024;

/** 从魔数判权威 mime；命中白名单外一律 null（fail closed，永不采信客户端）。 */
function sniffMime(buffer: Buffer): SurveyImageMime | null {
  if (buffer.length < 4) return null;
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * SVG 无魔数，按文本判定：跳过 BOM、空白、<?xml?>、注释与 <!DOCTYPE> 后，
 * 下一个元素必须是 <svg。净化在 assertSurveyImageUpload 里做。
 */
function sniffSvg(buffer: Buffer): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return false;
  }
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const head = Math.min(text.length, 8192);
  for (;;) {
    while (i < head && /\s/.test(text[i])) i++;
    if (i >= head) return false;
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end < 0) return false;
      i = end + 2;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end < 0) return false;
      i = end + 3;
      continue;
    }
    if (/^<!doctype/i.test(text.slice(i, i + 9))) {
      let j = i + 9;
      if (/\[/.test(text.slice(i, Math.min(i + 512, head)))) {
        const sub = text.indexOf("]", j);
        if (sub < 0) return false;
        j = sub + 1;
      }
      const end = text.indexOf(">", j);
      if (end < 0) return false;
      i = end + 1;
      continue;
    }
    break;
  }
  return text.startsWith("<svg", i) && /[\s/>]/.test(text[i + 4] ?? "");
}

// ── SVG 净化（与主仓 svg-sanitize.ts 同源；serve 端另有 CSP + nosniff 兜底）──

const purify = createDOMPurify(new JSDOM("").window);

const HREF_ATTRS = new Set(["href", "xlink:href", "src"]);
/** 位图 data: URL 白名单；svg 不在内（递归引入脚本面）。 */
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$/i;
/** CSS 里的外部资源 / 执行面；url() 只允许 # 片段。 */
const CSS_EXTERNAL =
  /@import|expression\s*\(|-moz-binding|behavior\s*:|url\(\s*['"]?\s*(?!#)[^)]*\)/i;

purify.addHook("uponSanitizeAttribute", (_node, event) => {
  const value = event.attrValue ?? "";
  if (HREF_ATTRS.has(event.attrName)) {
    const v = value.trim();
    if (!(v.startsWith("#") || DATA_IMAGE.test(v))) {
      event.keepAttr = false;
      return;
    }
  }
  if (CSS_EXTERNAL.test(value)) event.keepAttr = false;
});

purify.addHook("uponSanitizeElement", (node) => {
  if (node.nodeName === "style" && CSS_EXTERNAL.test(node.textContent ?? "")) {
    (node as Element).remove();
  }
});

function sanitizeSvg(input: string): string | null {
  const clean = purify.sanitize(input, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // <use> 收回（icon/symbol 复用刚需）：本场景输出是独立 SVG 文档 + href 已被
    // 钩子收紧到仅 # 片段，引用逃不出自身（与主仓 svg-sanitize.ts 同一论证）。
    ADD_TAGS: ["use"],
    FORBID_TAGS: ["a"],
  });
  const trimmed = clean.trim();
  if (
    !trimmed.toLowerCase().startsWith("<svg") ||
    !trimmed.toLowerCase().endsWith("</svg>")
  ) {
    return null;
  }
  return trimmed;
}

export interface ValidatedSurveyImage {
  mime: SurveyImageMime;
  ext: string;
  bytes: Buffer;
}

/** 校验选项图字节：empty/too_large/unsupported_type 三类拒绝，SVG 净化后返回。 */
export function assertSurveyImageUpload(
  buffer: Buffer,
  maxBytes: number,
): ValidatedSurveyImage {
  if (buffer.length === 0) {
    throw new InvalidUploadError("empty", "uploaded file is empty");
  }
  if (buffer.length > maxBytes) {
    throw new InvalidUploadError(
      "too_large",
      `uploaded file is ${buffer.length} bytes, exceeds limit ${maxBytes}`,
    );
  }
  const signed = sniffMime(buffer);
  const mime: SurveyImageMime | null =
    signed ?? (sniffSvg(buffer) ? "image/svg+xml" : null);
  if (!mime) {
    throw new InvalidUploadError(
      "unsupported_type",
      `unsupported file type (allowed: ${SURVEY_IMAGE_MIMES.join(", ")})`,
      signed,
    );
  }
  if (mime === "image/svg+xml") {
    if (buffer.length > SVG_MAX_BYTES) {
      throw new InvalidUploadError(
        "too_large",
        `svg file is ${buffer.length} bytes, exceeds limit ${SVG_MAX_BYTES}`,
      );
    }
    const clean = sanitizeSvg(buffer.toString("utf8"));
    if (!clean) {
      throw new InvalidUploadError(
        "unsupported_type",
        "svg content failed sanitization",
        mime,
      );
    }
    return { mime, ext: MIME_EXTENSIONS[mime], bytes: Buffer.from(clean, "utf8") };
  }
  return { mime, ext: MIME_EXTENSIONS[mime], bytes: buffer };
}
