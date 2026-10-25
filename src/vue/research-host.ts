// 研究分析扩展缝（issue #223 拆分）：research-data 的 analyses/runs/chart、
// 结果表与图表预览、用于论文，都属主站服务与生态，独立站不提供。数据段组件
// 只保留答卷列表（版本化、样本排除）与逐题摘要；研究面板作为组件由宿主经
// SurveysResearchPanelKey 注入，包只提供挂载点与激活状态，不 import 任何
// research 数据 API。主站装配：provide(SurveysResearchPanelKey, ResearchPanel)。
import { inject } from "vue";
import type { Component, InjectionKey } from "vue";

import type { SurveySampleExclusion } from "./lib/dataset.js";

/** 数据段传给研究面板的激活状态。 */
export interface SurveysResearchContext {
  surveyId: string;
  /** 数据段当前选中的采集版本（空串 = 尚未发布）。 */
  revisionId: string;
  canWrite: boolean;
  /** 答卷列表里标记的样本排除，研究配方原样承接。 */
  exclusions: SurveySampleExclusion[];
}

/** 宿主研究面板接收 context；select-revision 回传版本定位，
 *  update-exclusions 同步加载配方或恢复样本后的答卷排除状态。 */
export interface SurveysResearchPanelProps {
  context: SurveysResearchContext;
}

export type { SurveySampleExclusion } from "./lib/dataset.js";

export const SurveysResearchPanelKey: InjectionKey<Component> = Symbol(
  "surveys-research-panel",
);

/** 取宿主注入的研究面板；缺省返回 null（独立站没有研究分析，数据段不出挂载点）。 */
export function useSurveysResearchPanel(): Component | null {
  return inject(SurveysResearchPanelKey, null);
}
