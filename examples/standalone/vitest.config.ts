// 服务端应用层测试（src/*.test.ts）跑在包根：复用根 vite.config 会把 root 指
// 到 web/（前端子应用），测试文件就找不到了——这里显式钉回包根。
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
