<script setup lang="ts">
// 独立站登录页：单管理员密码 → POST /api/admin/login，成功后靠 HttpOnly
// 会话 cookie（前端不持任何 token）。文案 zh-CN 硬编码：本页是独立站自有的
// 装配件，不进问卷包的文案表。
import { ref } from "vue";
import { surveysBrandLogo } from "../../../../../src/brand.js";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";

import { markSignedIn } from "../session";

const route = useRoute();
const router = useRouter();

const password = ref("");
const busy = ref(false);
const failed = ref(false);

function safeRedirect(): string {
  const raw = route.query.redirect;
  const target = typeof raw === "string" ? raw : "";
  // 只收站内路径：单个 / 开头，// 开头是协议相对外链。
  return target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

async function submit(): Promise<void> {
  if (busy.value || !password.value) return;
  busy.value = true;
  failed.value = false;
  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password.value }),
    });
    if (!response.ok) {
      failed.value = true;
      return;
    }
    markSignedIn();
    await router.replace(safeRedirect());
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="tw:flex tw:h-full tw:min-h-0 tw:items-center tw:justify-center tw:px-4">
    <form
      class="tw:flex tw:w-full tw:max-w-sm tw:flex-col tw:gap-4"
      style="background: var(--color-surface-base); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-xl); padding: 28px; box-shadow: var(--shadow-lg);"
      @submit.prevent="submit"
    >
      <div class="login-brand" v-html="surveysBrandLogo" />
      <h1 class="tw:m-0" style="font-size: 18px; font-weight: 600; color: var(--color-text-primary);">
        问卷管理登录
      </h1>
      <p class="tw:m-0" style="font-size: 12.5px; color: var(--color-text-secondary);">
        输入管理员密码，进入问卷工作台。
      </p>
      <label class="tw:flex tw:flex-col tw:gap-2">
        <span style="font-size: 13px; color: var(--color-text-primary);">管理员密码</span>
        <InputText
          v-model="password"
          type="password"
          autocomplete="current-password"
          fluid
          autofocus
        />
      </label>
      <Message v-if="failed" severity="error" :closable="false">
        密码错误或会话已失效，请重试。
      </Message>
      <Button type="submit" label="登录" :loading="busy" fluid />
    </form>
  </main>
</template>

<style scoped>
.login-brand { width: 200px; max-width: 100%; line-height: 0; margin-bottom: 8px; }
.login-brand :deep(svg) { width: 100%; height: auto; }
</style>
