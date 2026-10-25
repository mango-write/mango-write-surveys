// 本仓独立测试配置（pnpm test；主仓内跑测试走主仓根 vitest.config 的物理
// 隔离与别名口径）。组件测试按文件名进 dom 档；pg-storage 的 DB 套件在
// TEST_DATABASE_URL/DATABASE_URL 不可达时自行 skip（reachable 探测），CI 用
// postgres service 供库即可真跑。
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

const domPatterns = ["**/*.component.test.ts", "**/*.dom.test.ts"];
const baseExclude = ["**/node_modules/**", "**/dist/**", "examples/**"];

export default defineConfig({
  plugins: [vue()],
  test: {
    projects: [
      {
        // vitest 4 的 projects 默认不继承根配置的 vue 插件。
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: [...baseExclude, ...domPatterns],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "happy-dom",
          include: domPatterns,
          exclude: baseExclude,
        },
      },
    ],
  },
});
