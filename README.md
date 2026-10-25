# MangoWrite Surveys

一个可自部署的科研问卷工具，覆盖问卷设计、版本化发布、匿名作答、数据查看与导出。内置 Vue 工作台、HTTP API、PostgreSQL 存储和 AI 建卷示例，也提供可用于其他应用的组件与服务接口。

## 功能

- **问卷设计**：多种题型、分页、条件显示、跳转、图片选项、预览、撤销重做与自动保存。
- **发布与回收**：不可变发布版本、填写链接与二维码、回收上限、暂停和恢复。
- **匿名作答**：知情同意、浏览器续答、答案校验和提交回执。
- **数据查看**：按发布版本查看答卷、逐题摘要、原始答卷 CSV 与变量字典导出。
- **AI 辅助**：使用 OpenAI 兼容接口生成问卷，提供读卷、改卷与建卷工具。

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

服务端使用 `createStandaloneSurveysPorts()` 配置数据库与媒体目录，再创建服务和路由。前端通过 `SurveysWebHost` 配置请求、导航、通知和 Markdown 渲染。

完整示例位于 [`examples/standalone`](examples/standalone/README.md)。自定义集成可以分别实现[服务端接口](src/ports.ts)与[前端接口](src/vue/host.ts)。

## 研究标准与评测集

[`src/standards`](src/standards) 维护问卷研究质量的检查标准目录（八维度：研究目标、人群与招募、测量覆盖、表述、选项、流程、负担、分析可行性）、首批三类研究的适用条件与限制，以及用于评测生成与诊断链路的案例集。每条标准带方法学来源（AAPOR、Pew、CDC 认知访谈、COSMIN）、适用条件、错误示例与处理方式，并按 rule / judgment / human_data 三级标注实现路径；`src/standards/standards.test.ts` 与 `src/standards/eval/eval-dataset.test.ts` 把「每条合格」变成可执行门禁。标准当前处于草案状态（待方法学专家审核），不构成专业认证。

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
