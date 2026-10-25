// 问卷包自持文案：键挂在宿主 i18n 的 `surveys` 命名空间下。宿主在装配处合并
// （主站经 feature-shard 聚合保持 ADR 0007；独立站直接并入 createI18n）。
import zhCN from "./zh-CN.js";
import enUS from "./en-US.js";

export const surveysMessages = {
  "zh-CN": { surveys: zhCN },
  "en-US": { surveys: enUS },
} as const;

export type SurveysLocaleSource = keyof typeof surveysMessages;
