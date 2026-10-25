// 问卷采集的有界预算（规格：每版本 5000 份、14 天会话、提交 64KiB）。
// 上限是「诚实失败」的判据，不在这里做截断或采样。

/** 会话有效期：产品承诺「14 天内可续答」，过期未提交的会话不再接受提交。 */
export const SURVEY_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** 发布定义上限（服务层按 JSON 字节数检查，schema 本身不表达字节）。 */
export const SURVEY_DEFINITION_MAX_BYTES = 512 * 1024;

/** 管理面写入允许的最大请求体：定义 512KiB + JSON 包裹余量。 */
export const SURVEY_MANAGE_BODY_MAX_BYTES = 640 * 1024;

/** 选项图上传：单文件 5MB（字节嗅探白名单仅图片）；multipart 外壳给足余量，
 *  权威字节闸在 assertValidUpload。 */
export const SURVEY_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const SURVEY_MEDIA_BODY_MAX_BYTES = 6 * 1024 * 1024;

/** 提交体上限 64KiB（含答案与 sessionToken），在 JSON 解析前拦下。 */
export const SURVEY_SUBMIT_BODY_MAX_BYTES = 64 * 1024;

/** start 只带 resumeToken/consent，给足余量即可。 */
export const SURVEY_START_BODY_MAX_BYTES = 4 * 1024;

/** 单版本可读取/导出的已提交答卷上限，与 responseLimit 默认值同源。 */
export const SURVEY_MAX_RESPONSES = 5000;

/**
 * 匿名采集限流（每 IP 每分钟）。取整页问卷的填写节奏而不是 API 抓取节奏：
 * 校园/企业出口 NAT 后一群人会共享同一个 IP，桶太小会把正常受访者挡在外面。
 */
export const SURVEY_START_RATE_PER_MINUTE = 60;
export const SURVEY_SUBMIT_RATE_PER_MINUTE = 120;
