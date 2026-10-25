// 问卷独立站前端（web/ 子应用）的 vite 装配：root 指向 web/，构建产物进
// web/dist，由 src/main.ts（Hono）静态托管。dev 期 /api 反代到同机独立站
// server（PORT 与 .env 同源，默认 3100），登录 cookie 走同源代理自动携带。
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  envDir: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [vue(), tailwindcss()],
  resolve: {
    // 包页面（@mango-write/surveys、@mango-write/ui）与本 app 必须共享同一个
    // vue / vue-i18n / primevue 运行时实例，provide/inject 与 Toast 上下文才成立。
    dedupe: ["vue", "vue-router", "vue-i18n", "primevue"],
  },
  server: {
    port: Number(process.env.WEB_PORT) || 5180,
    proxy: {
      "/api": { target: `http://localhost:${process.env.PORT || 3100}` },
    },
  },
  build: {
    outDir: "dist",
  },
});
