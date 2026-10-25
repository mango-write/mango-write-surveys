# MangoWrite Surveys

一个可自部署的科研问卷工具，覆盖问卷设计、版本化发布、匿名作答、数据查看与导出。内置 Vue 工作台、HTTP API、PostgreSQL 存储和 AI 建卷示例，也提供可用于其他应用的组件与服务接口。

## 功能

- **问卷设计**：多种题型、分页、条件显示、跳转、图片选项、预览、撤销重做与自动保存。
- **发布与回收**：不可变发布版本、填写链接与二维码、回收上限、暂停和恢复。
- **匿名作答**：知情同意、浏览器续答、答案校验和提交回执。
- **数据查看**：按发布版本查看答卷、逐题摘要、原始答卷 CSV 与变量字典导出。
- **外部研究数据**：导入带来源与许可说明的 CSV，自动匹配题目变量，披露重复记录但不静默删除；按结构化研究计划运行信度、主轴 EFA、HC3 回归与调节中介。分析页以关键指标、ECharts 图表和完整结果表分层呈现；固定 seed 的 Bootstrap 结果绑定不可变数据集、发布版本和输入/结果哈希，可导出自包含 HTML、JSON 与 CSV。HTML 内嵌同一次运行的 SVG 图表和复核附录，离线可读且不依赖外部脚本。横断面关联不解释为因果，EFA 与信度不构成量表认证。
- **AI 辅助**：使用 OpenAI 兼容接口生成问卷，提供完整读卷、改卷、建卷与结构化诊断工具；研究设计可记录目标人群、测量维度、题目映射、计分、可执行分析模型和作者自报试填反馈。诊断建议须由作者选择应用，不代表信效度验证；统计数值由确定性引擎计算，不由语言模型生成。

## 快速开始

准备 Node.js 24+、pnpm 10.20.0 和 PostgreSQL 13+。

```bash
git clone https://github.com/mango-write/mango-write-surveys.git
cd mango-write-surveys
pnpm install --frozen-lockfile
```

可以使用 Docker 启动 PostgreSQL：

```bash
docker run -d --name mango-surveys-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mango_surveys \
  -p 5432:5432 -v mango-surveys-pg:/var/lib/postgresql postgres:18
```

配置并启动应用：

```bash
cd examples/standalone
cp .env.example .env
# 编辑 .env：填写数据库连接，并设置管理员密码
pnpm db:init
pnpm web:build
pnpm start
```

打开 <http://localhost:3100> 登录，创建问卷并发布。填写者通过 `/s/:slug` 链接参与作答。

AI 配置、开发模式和部署说明见[应用指南](examples/standalone/README.md)。

## 在其他应用中使用

| 导入入口 | 提供的能力 |
|---|---|
| `@mango-write/surveys/core` | 问卷定义、校验、操作与重放 |
| `@mango-write/surveys/contracts` | Zod schema、API 请求与响应类型 |
| `@mango-write/surveys/server` | 问卷、采集和媒体服务；Hono 路由 |
| `@mango-write/surveys/vue` | 问卷列表、设计器、作答页与数据组件 |
| `@mango-write/surveys/ai` | AI 生成、领域工具与模型接口 |
| `@mango-write/surveys/adapters` | PostgreSQL、文件媒体与默认授权实现 |
| `@mango-write/surveys/ports` | 授权、事务存储和媒体接口 |

服务端使用 `createStandaloneSurveysPorts()` 配置数据库与媒体目录，再创建服务和路由。前端通过 `SurveysWebHost` 配置请求、导航、通知和 Markdown 渲染。可选 `workbenchShell` 复用宿主的左栏与中心布局；可选 `copilot.sendPrompt(text, toolNames)` 支持一键诊断和完善设计，未提供时退回预填输入框。研究设计与试填记录仅供作者使用，不进入匿名问卷。

完整示例位于 [`examples/standalone`](examples/standalone/README.md)。自定义集成可以分别实现[服务端接口](src/ports.ts)与[前端接口](src/vue/host.ts)。

## 研究标准与评测集

[`src/standards`](src/standards) 维护研究质量检查目录、研究类型及评测案例。规则分 rule / judgment / human_data；结构测试只核验字段与引用，不能证明方法学正确。标准采用[证据审查协议](src/standards/review-protocol.ts)，Agent 独立核对来源、测量逻辑和反例，无需等待专家团；结果是内部代理证据，不构成专业认证，也不替代真人预测试。

复用评测时，由 `src/standards/eval` 的 `buildBlindEdgePacket` 生成仅含匿名编号、情境与待判主张的输入，答案、理由和原始案例 ID 不交给首轮评审。已公开的案例仍是工作集，匿名化不使其成为真正留出集。首轮封存后按原始证据裁决，保留模型、提示词、输入哈希、原始输出及未决项；同模型不同角色不算跨模型验证。

`summarizeReviewDecisions` 汇总已去重的问题裁决，目录外问题也进入分母；报告支持率上下界、裁决覆盖率和证据来源，不将 Agent 共识写成准确率。每条定论须有来源位置与推理，重复问题 ID 拒绝计数；问题归一化与证据真实性仍需审查，工具不会自动认证。

## 开发

在仓库根目录运行：

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @mango-write/surveys-standalone-example typecheck
pnpm --filter @mango-write/surveys-standalone-example test
pnpm --filter @mango-write/surveys-standalone-example web:build
```

设置 `TEST_DATABASE_URL` 可运行 PostgreSQL 测试。测试使用独立数据库 `mango_surveys_test`，会创建和删除该库。

欢迎通过 Issues 和 Pull Requests 参与项目，详见[贡献指南](CONTRIBUTING.md)。

## 许可

[AGPL-3.0-or-later](LICENSE)。部署与授权信息见[许可说明](LICENSING.md)。
