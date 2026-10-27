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
import Tag from "primevue/tag";

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
const completionRate = computed(() =>
  props.startedCount > 0 ? Math.min(100, Math.round((props.completedCount / props.startedCount) * 100)) : 0,
);
const remainingCount = computed(() => Math.max(0, props.responseLimit - props.completedCount));

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
      <div class="share-main">
        <header class="distribute-heading">
          <h2>{{ t("surveys.share") }}</h2>
          <Tag :value="t(`surveys.status.${status}`)"
            :severity="status === 'published' ? 'success' : status === 'paused' ? 'warn' : 'secondary'" />
        </header>
        <div class="share-row">
          <InputText :model-value="shareUrl" readonly fluid :aria-label="t('surveys.publicLink')" />
          <Button :label="t('surveys.copyLink')" icon="pi pi-copy" @click="copyLink" />
        </div>
      </div>
      <img v-if="qr" class="share-qr" :src="qr" :alt="t('surveys.qr')" />
    </section>

    <section class="distribute-metrics" :aria-label="t('surveys.collectProgress')">
      <div class="metric">
        <span>{{ t("surveys.completedMetric") }}</span>
        <strong>{{ completedCount }}</strong>
      </div>
      <div class="metric">
        <span>{{ t("surveys.startedMetric") }}</span>
        <strong>{{ startedCount }}</strong>
      </div>
      <div class="metric metric--rate">
        <span>{{ t("surveys.completionRate") }}</span>
        <strong>{{ completionRate }}<small>%</small></strong>
      </div>
    </section>

    <section class="distribute-card">
      <header class="distribute-heading">
        <h2>{{ t("surveys.collectProgress") }}</h2>
        <span class="progress-count">{{ t("surveys.progressCount", { completed: completedCount, limit: responseLimit }) }}</span>
      </header>
      <div class="progress-block">
        <ProgressBar :value="progressValue" :show-value="false" class="collect-bar" />
        <div class="progress-caption">
          <span>{{ t("surveys.progressPercent", { value: progressValue }) }}</span>
          <span>{{ t("surveys.remainingCount", { count: remainingCount }) }}</span>
        </div>
      </div>
      <div class="limit-row">
        <label class="limit-field" for="survey-response-limit">
          <span>{{ t("surveys.responseLimit") }}</span>
          <small>{{ t("surveys.responseLimitHint") }}</small>
        </label>
        <InputNumber
          input-id="survey-response-limit"
          :model-value="responseLimit"
          fluid
          :min="1"
          :max="10000"
          :step="1"
          :disabled="!canWrite || busy"
          :aria-label="t('surveys.responseLimit')"
          @update:model-value="onLimitChange"
        />
      </div>
    </section>

    <section class="distribute-card">
      <header class="distribute-heading">
        <h2>{{ t("surveys.collectStatus") }}</h2>
        <Tag :value="t(`surveys.status.${status}`)"
          :severity="status === 'published' ? 'success' : status === 'paused' ? 'warn' : 'secondary'" />
      </header>
      <SurveyStatusActions
        layout="cards"
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
  gap: 16px;
  width: 100%;
  max-width: 64rem;
  margin-inline: auto;
}
.distribute-card {
  display: grid;
  gap: 20px;
  padding: 24px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--elevation-2-surface);
  box-shadow: var(--elevation-2-shadow);
}
.distribute-card--share {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 24px;
  border-color: var(--color-brand-200);
  background: var(--gradient-surface-accent);
}
.distribute-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.distribute-heading h2 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-title-sm);
  font-weight: 600;
}
.share-main {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.share-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.share-qr {
  width: 128px;
  height: 128px;
  padding: 8px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-base);
}
.distribute-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.metric {
  display: grid;
  gap: 8px;
  padding: 20px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--elevation-2-surface);
  box-shadow: var(--elevation-2-shadow);
}
.metric > span {
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
}
.metric strong {
  font-size: 28px;
  font-weight: 650;
  line-height: var(--line-height-tight);
  font-variant-numeric: tabular-nums;
}
.metric--rate strong { color: var(--color-success-600); }
.metric small {
  margin-left: 2px;
  font-size: var(--font-size-body-sm);
  font-weight: 500;
}
.progress-count,
.progress-caption {
  color: var(--color-text-secondary);
  font-size: var(--font-size-body-sm);
  font-variant-numeric: tabular-nums;
}
.progress-block {
  display: grid;
  gap: 8px;
}
.collect-bar { height: 8px; }
.progress-caption {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: var(--font-size-caption);
}
.limit-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 160px;
  align-items: end;
  gap: 16px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border-subtle);
}
.limit-field {
  display: grid;
  gap: 4px;
  color: var(--color-text-primary);
  font-size: var(--font-size-body-sm);
  font-weight: 500;
}
.limit-field small {
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  font-weight: 400;
}
@media (max-width: 767.98px) {
  .distribute-card { padding: 16px; }
  .distribute-card--share { grid-template-columns: 1fr; }
  .share-qr { justify-self: center; }
  .share-row { grid-template-columns: 1fr; }
  .distribute-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric:last-child { grid-column: 1 / -1; }
  .limit-row { grid-template-columns: 1fr; }
}
</style>
