<script setup lang="ts">
// 应用壳：挂 PrimeVue 的 Toast / ConfirmDialog 单例，并在 setup 内装配
// SurveysWebHost（useToast 需要组件上下文）后 provide 给包页面。AI 建卷
// 面板挂 App 级（列表页与工作台都用得到），交付帧经 copilot 桥交给当前页。
import { provide, watch } from "vue";
import { surveysBrandLogo } from "../../../../src/brand.js";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import { useThemePreference } from "@mango-write/ui";
import { useRoute } from "vue-router";
import Toast from "primevue/toast";
import ConfirmDialog from "primevue/confirmdialog";
import { useToast } from "primevue/usetoast";
import {
  SurveysHostKey,
  SurveysResearchPanelKey,
  SurveyResearchPanel,
} from "@mango-write/surveys/vue";

import { createWebHost } from "./host";
import { router } from "./router";
import StandaloneAiPanel from "./ai/StandaloneAiPanel.vue";
import { createStandaloneCopilot } from "./ai/standalone-copilot";

const copilot = createStandaloneCopilot();
provide(SurveysHostKey, createWebHost(router, useToast(), copilot.host));
// 研究分析面板（数据来源 → 研究计划 → 固定运行结果）由本站注入工作台数据段。
provide(SurveysResearchPanelKey, SurveyResearchPanel);
const route = useRoute();
const { t, locale } = useI18n();
const { resolved, setTheme } = useThemePreference();
watch(locale, value => {
  document.documentElement.lang = value;
  try { localStorage.setItem("surveys:locale", value); } catch {}
});
const sourceUrl = import.meta.env.VITE_SURVEYS_SOURCE_URL ||
  "https://github.com/mango-write/mango-write-surveys/tree/v0.1.0";
</script>

<template>
  <Toast position="top-center" />
  <ConfirmDialog />
  <div class="standalone-app">
    <div class="standalone-preferences">
      <Button :icon="resolved === 'dark' ? 'pi pi-sun' : 'pi pi-moon'" :aria-label="t(resolved === 'dark' ? 'standalone.light' : 'standalone.dark')" :title="t(resolved === 'dark' ? 'standalone.light' : 'standalone.dark')" text severity="secondary" @click="setTheme(resolved === 'dark' ? 'light' : 'dark')" />
      <Button :label="locale === 'zh-CN' ? 'EN' : '中文'" :aria-label="t('standalone.language')" text severity="secondary" @click="locale = locale === 'zh-CN' ? 'en-US' : 'zh-CN'" />
    </div>
    <div class="standalone-route"><RouterView /></div>
    <footer class="standalone-license">
      <span class="standalone-brand" v-html="surveysBrandLogo" />
      <span>© 2026 MangoWrite contributors</span>
      <a :href="sourceUrl" target="_blank" rel="noopener noreferrer">{{ t("standalone.source") }}</a>
      <a
        href="https://github.com/mango-write/mango-write-surveys/blob/v0.1.0/LICENSE"
        target="_blank"
        rel="noopener noreferrer"
      >AGPL-3.0-or-later</a>
      <span>{{ t("standalone.license") }}</span>
    </footer>
  </div>
  <StandaloneAiPanel
    v-if="route.name !== 'login' && route.name !== 'surveys.public'"
    :state="copilot.state"
    @delivery="copilot.emitDelivery"
  />
</template>

<style scoped>
.standalone-preferences { display: flex; justify-content: flex-end; gap: .25rem; padding: .25rem .75rem; flex: none; }
.standalone-app {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.standalone-route {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.standalone-route :deep(.survey-public) {
  height: 100%;
  box-sizing: border-box;
}
.standalone-brand { display: block; width: 108px; line-height: 0; }
.standalone-brand :deep(svg) { width: 100%; height: auto; }
.standalone-license {
  align-items: center;
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--color-border-subtle);
  color: var(--color-text-secondary);
  font-size: 12px;
}
.standalone-license a {
  color: inherit;
}
</style>
