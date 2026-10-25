<script setup lang="ts">
// 发放段页面（issue #217）：分享链接 + 二维码、回收概况（已完成 / 上限
// 进度 + 已开始数）、回收上限编辑与状态机快捷入口。上限经宿主的提交变更入口
// 进自动保存（与 definition 同一 PATCH、同一乐观锁），这里不另开写路径。
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import ProgressBar from "primevue/progressbar";

import type { SurveyStatus } from "../../contracts/index.js";

import { useSurveysNotify } from "../notify.js";

import SurveyStatusActions from "./SurveyStatusActions.vue";

const props = defineProps<{
  slug: string;
  status: SurveyStatus;
  completedCount: number;
  startedCount: number;
  responseLimit: number;
  canWrite: boolean;
  busy?: boolean;
}>();
const emit = defineEmits<{
  "update:responseLimit": [value: number];
  change: [status: "published" | "paused"];
  close: [];
}>();
const { t } = useI18n();
const notify = useSurveysNotify();

const shareUrl = computed(() => `${location.origin}/s/${props.slug}`);
const qr = ref("");
watch(
  () => props.slug,
  async (slug) => {
    if (!slug) return;
    // 二维码依赖按需加载（沿用发布成功弹窗时代的方案，不进首屏静态图）。
    const QRCode = await import("qrcode");
    qr.value = await QRCode.toDataURL(`${location.origin}/s/${slug}`, {
      width: 240,
      margin: 2,
    });
  },
  { immediate: true },
);

const progressValue = computed(() => {
  if (!props.responseLimit || props.responseLimit <= 0) return 0;
  return Math.min(100, Math.round((props.completedCount / props.responseLimit) * 100));
});

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    notify.success(t("surveys.copyLinkDone"));
  } catch {
    // 剪贴板被拒（权限/非安全上下文）：链接框本身就是可选中复制的全文本，不打断。
    notify.warn(t("surveys.copyLinkFailed"));
  }
}
function onLimitChange(value: number | null) {
  emit("update:responseLimit", value ?? 1);
}
</script>
<template>
  <div class="survey-distribute">
    <section class="distribute-card distribute-card--share">
      <h2>{{ t("surveys.share") }}</h2>
      <div class="share-row">
        <InputText
          :model-value="shareUrl"
          readonly
          fluid
          :aria-label="t('surveys.publicLink')"
        /><Button
          :label="t('surveys.copyLink')"
          icon="pi pi-copy"
          severity="secondary"
          @click="copyLink"
        />
      </div>
      <div class="share-body">
        <img v-if="qr" :src="qr" :alt="t('surveys.qr')" />
        <p class="tw:text-muted">{{ t("surveys.shareHint") }}</p>
      </div>
    </section>
    <section class="distribute-card">
      <h2>{{ t("surveys.collectProgress") }}</h2>
      <ProgressBar :value="progressValue" :show-value="false" class="collect-bar" />
      <p class="collect-detail">
        {{ t("surveys.progressDetail", { completed: completedCount, limit: responseLimit, started: startedCount }) }}
      </p>
      <label class="limit-field"
        >{{ t("surveys.responseLimit") }}<InputNumber
          :model-value="responseLimit"
          :min="1"
          :max="10000"
          :step="1"
          :disabled="!canWrite || busy"
          :aria-label="t('surveys.responseLimit')"
          @update:model-value="onLimitChange"
        /><small class="tw:text-muted">{{ t("surveys.responseLimitHint") }}</small></label>
    </section>
    <section class="distribute-card">
      <h2>{{ t("surveys.collectStatus") }}</h2>
      <SurveyStatusActions
        :status="status"
        :has-revision="true"
        :can-write="canWrite"
        :busy="busy"
        @change="emit('change', $event)"
        @close="emit('close')"
      />
    </section>
  </div>
</template>
<style scoped>
.survey-distribute {
  display: grid;
  gap: var(--layout-card-padding-lg);
  /* 放宽到中岛可用宽度：分享卡通栏，概况/状态两卡在宽岛并排（窄岛自动单列）。 */
  grid-template-columns: repeat(auto-fit, minmax(min(24rem, 100%), 1fr));
}
.distribute-card--share {
  grid-column: 1 / -1;
}
.distribute-card {
  display: grid;
  gap: var(--layout-card-padding);
  padding: var(--layout-card-padding);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 10px);
  background: var(--material-inlay);
}
.distribute-card h2 {
  margin: 0;
  font-size: var(--font-size-title-sm, 14px);
  color: var(--color-text-primary);
}
.share-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.share-row > :first-child {
  flex: 1;
  min-width: 0;
}
.share-body {
  display: flex;
  align-items: center;
  gap: var(--layout-card-padding);
  flex-wrap: wrap;
}
.share-body img {
  width: 120px;
  height: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 6px);
}
.share-body p {
  margin: 0;
  min-width: 12rem;
  flex: 1;
}
.collect-bar {
  height: 8px;
}
.collect-detail {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.limit-field {
  display: grid;
  gap: 0.5rem;
  max-width: 16rem;
}
@media (max-width: 767.98px) {
  .share-row {
    flex-wrap: wrap;
  }
  .share-row > :first-child {
    flex: 1 1 100%;
  }
}
</style>
