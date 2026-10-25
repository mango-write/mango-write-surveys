import "dotenv/config";

import { initStandaloneSchema } from "@mango-write/surveys/adapters";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("缺少 DATABASE_URL（见 .env.example）");
  process.exit(1);
}

await initStandaloneSchema(DATABASE_URL);
console.log("问卷表结构就绪（幂等 DDL 已应用）");
