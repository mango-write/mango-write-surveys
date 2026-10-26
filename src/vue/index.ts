// @mango-write/surveys/vue 出口：页面、宿主契约与装配辅助。宿主从这里 import
// 页面组件并 provide SurveysHostKey；研究分析扩展经 SurveysResearchPanelKey 注入。
export {
  SurveysApiError,
  SurveysHostKey,
  useSurveysHost,
  useSurveysLayoutPrefs,
  type SurveysWebHost,
  type SurveysNotify,
  type SurveysRouteTarget,
  type SurveysTransport,
  type SurveysCopilotHost,
  type SurveysCopilotContextRef,
  type SurveysCopilotHandlers,
  type SurveysCopilotSurface,
  type SurveysCopilotSurfaceAction,
  type SurveysCopilotSurfacePresentation,
  type SurveysLayoutDefaults,
  type SurveysLayoutPrefs,
} from "./host.js";
export {
  createSurveysApi,
  createPublicSurveysApi,
  useSurveysApi,
  usePublicSurveysApi,
  type SurveysApi,
  type PublicSurveysApi,
} from "./api.js";
export { useSurveysNotify } from "./notify.js";
export {
  SurveysResearchPanelKey,
  useSurveysResearchPanel,
  type SurveysResearchContext,
  type SurveysResearchPanelProps,
  type SurveySampleExclusion,
} from "./research-host.js";
export { surveysMessages } from "./locale/index.js";
export type { ToolSurveyDelivery } from "../contracts/index.js";
export { default as SurveyListPage } from "./pages/SurveyListPage.vue";
export { default as SurveyWorkspacePage } from "./pages/SurveyWorkspacePage.vue";
export { default as SurveyPublicPage } from "./pages/SurveyPublicPage.vue";
export { default as SurveyDataAnalysis } from "./components/SurveyDataAnalysis.vue";
export { default as SurveyResearchPanel } from "./components/SurveyResearchPanel.vue";
