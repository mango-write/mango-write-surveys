// 独立站前端装配：createApp + PrimeVue（MangoPreset）+ vue-router + vue-i18n。
// 页面全部来自 @mango-write/surveys/vue，宿主契约的 provide 在 App.vue 完成
// （useToast 需要组件上下文）。
import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import PrimeVue from "primevue/config";
import ConfirmationService from "primevue/confirmationservice";
import ToastService from "primevue/toastservice";

import { initTheme, MangoPreset, mergeUiMessages, vTooltip } from "@mango-write/ui";
import { surveysMessages } from "@mango-write/surveys/vue";

import { standaloneMessages } from "./locale";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

initTheme();

let savedLocale = "zh-CN";
try { savedLocale = localStorage.getItem("surveys:locale") === "en-US" ? "en-US" : "zh-CN"; } catch {}
document.documentElement.lang = savedLocale;
const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: "zh-CN",
  messages: {
    "zh-CN": { ...surveysMessages["zh-CN"], standalone: standaloneMessages["zh-CN"] },
    "en-US": { ...surveysMessages["en-US"], standalone: standaloneMessages["en-US"] },
  },
});
mergeUiMessages(i18n);

const app = createApp(App);
app.use(PrimeVue, {
  theme: { preset: MangoPreset, options: { darkModeSelector: '[data-theme="dark"]' } },
});
app.use(ToastService);
app.use(ConfirmationService);
app.use(i18n);
app.use(router);
app.directive("tooltip", vTooltip);
app.mount("#app");
