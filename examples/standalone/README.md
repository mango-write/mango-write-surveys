# MangoWrite Surveys 应用指南

运行一个带问卷设计器、管理员登录、AI 建卷和匿名作答页面的问卷网站。

## 安装与启动

准备 Node.js 24+、pnpm 10.20.0 和 PostgreSQL 13+。

```bash
git clone https://github.com/mango-write/mango-write-surveys.git
cd mango-write-surveys
pnpm install --frozen-lockfile
cd examples/standalone
cp .env.example .env
```

在 `.env` 中填写配置：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串，数据库需已创建 |
| `MEDIA_DIR` | 图片存储目录，默认示例为 `./data/surveys-media` |
| `ADMIN_PASSWORD` | 管理员密码，建议使用 `openssl rand -base64 32` 生成 |
| `PORT` | HTTP 端口，默认 `3100` |
| `VITE_SURVEYS_SOURCE_URL` | 当前部署版本的源码地址，在前端构建时读取 |

构建并启动：

```bash
pnpm db:init
pnpm web:build
pnpm start
```

打开 <http://localhost:3100>，输入管理员密码。创建或选择模板后，可以调整题目、预览、发布，再分享填写链接。回收的数据可在工作台查看摘要并导出。

## AI 建卷

在 `.env` 配置 OpenAI 兼容接口：

```dotenv
SURVEYS_AI_URL=https://api.example.com/v1/chat/completions
SURVEYS_AI_API_KEY=your-api-key
SURVEYS_AI_MODEL=your-model
SURVEYS_AI_TIMEOUT_MS=60000
```

配置前三项后，点击列表页的“AI 生成”，填写标题与需求简述。生成的问卷会进入设计器，可以继续修改、预览和发布。超时默认 `60000` 毫秒。

## 开发模式

在两个终端中分别运行：

```bash
pnpm dev
```

```bash
pnpm web:dev
```

前端位于 <http://localhost:5180>，API 位于 <http://localhost:3100>。前端开发服务器代理 `/api` 请求。

## 页面与 API

| 页面 | 用途 |
|---|---|
| `/login` | 管理员登录 |
| `/` | 问卷列表与创建 |
| `/surveys/:surveyId` | 设计、发布和数据查看 |
| `/s/:slug` | 公开作答 |

| API | 用途 |
|---|---|
| `POST /api/admin/login` | 使用 `{ "password": "…" }` 登录并获取会话 cookie |
| `/api/surveys/**` | 问卷管理、发布、导出与图片上传 |
| `POST /api/ai/generate` | AI 建卷 |
| `/api/survey-public/**` | 匿名作答与公开图片 |
| `GET /healthz` | 健康检查 |

管理和 AI API 使用管理员会话。匿名作答 API 可直接通过公开链接访问。

## 部署

应用以单进程运行，通过 HTTPS 反向代理对外提供服务。管理员会话保存在进程内，重启后重新登录即可。反向代理可配置 `Secure` cookie 和请求限流。

备份 PostgreSQL 与 `MEDIA_DIR`，它们共同保存问卷、答卷及图片。

页面底部提供源代码与许可链接。部署修改版时，在构建前将 `VITE_SURVEYS_SOURCE_URL` 设置为实际运行版本的源码树或归档地址，然后运行 `pnpm web:build`。详细说明见[许可说明](../../LICENSING.md)。

## 项目结构

- `src/`：HTTP 服务、登录和模型调用配置。
- `web/src/`：Vue 应用、路由、请求与通知配置。
- `web/dist/`：前端构建输出，由 HTTP 服务提供访问。
