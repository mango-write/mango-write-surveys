// 显式钉回独立站包根；web 组件测试用文件级 happy-dom 环境，其余跑 node。
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: { conditions: ["mango-source"] },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "web/src/**/*.test.ts"],
  },
});
