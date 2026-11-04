// 独立站前端装配：createApp + @mango-write/ui（confirm/notify/theme）+ vue-router + vue-i18n。
// 页面全部来自 @mango-write/surveys/vue，宿主契约的 provide 在 App.vue 完成。
import { createApp } from "vue";
import { createI18n } from "vue-i18n";

import { initTheme, mergeUiMessages, vTooltip } from "@mango-write/ui";
import { provideConfirm } from "@mango-write/ui/lib/confirm";
import { provideNotify } from "@mango-write/ui/lib/notify";
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
provideNotify(app);
provideConfirm(app);
app.use(i18n);
app.use(router);
app.directive("tooltip", vTooltip);
app.mount("#app");
