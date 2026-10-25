// 路由表与登录守卫（独立站自持）：路由名与包的 SurveysRouteTarget 三元一一
// 对应（host.navigate 的映射契约）：surveys.list → /，
// surveys.detail → /surveys/:surveyId，surveys.public → /s/:slug。
import { createRouter, createWebHistory } from "vue-router";

import { SurveyListPage, SurveyPublicPage, SurveyWorkspacePage } from "@mango-write/surveys/vue";

import LoginPage from "./pages/LoginPage.vue";
import { isSignedIn, markSignedIn, probeSession } from "./session";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: LoginPage },
    { path: "/", name: "surveys.list", component: SurveyListPage },
    { path: "/s/:slug", name: "surveys.public", component: SurveyPublicPage, props: true },
    { path: "/surveys/:surveyId", name: "surveys.detail", component: SurveyWorkspacePage },
  ],
});

// /s/* 是匿名采集面；其余页面未登录一律送 /login。登录态探测只在本地无标记时
// 发一次 GET /api/surveys（HttpOnly cookie 前端不可读，只能问服务端）。
router.beforeEach(async (to) => {
  if (to.name === "surveys.public" || to.name === "login") return true;
  if (isSignedIn()) return true;
  if (await probeSession()) {
    markSignedIn();
    return true;
  }
  return { name: "login", query: to.fullPath === "/" ? {} : { redirect: to.fullPath } };
});
