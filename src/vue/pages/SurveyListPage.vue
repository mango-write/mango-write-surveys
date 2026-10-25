<script setup lang="ts">
// 问卷列表页（issue #217）：搜索/状态筛选 + 三个建卷入口（AI 生成 / 模板 /
// 空白新建）。导航一律走宿主 host.navigate（spaceLink 的 u./t. 前缀是宿主
// 语义）；survey_create 交付帧经 host.copilot 桥接：载荷交接给工作区 + toast
// + 导航，本页不感知 copilot-island 内部。
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import InputText from "primevue/inputtext";
import Tag from "primevue/tag";
import Message from "primevue/message";
import { ClipboardList } from "lucide-vue-next";
import type { SurveyStatus, SurveySummary } from "../../contracts/index.js";

import { AsyncSlot } from "@mango-write/ui";
import { useSurveysHost, type SurveysCopilotHandlers } from "../host.js";
import { useSurveysNotify } from "../notify.js";
import { useSurveysApi } from "../api.js";
import { setAiCreatedSurveyHandoff } from "../lib/ai-created-handoff.js";
import SurveyPageHeader from "../components/SurveyPageHeader.vue";
import SurveyTemplatePicker from "../components/SurveyTemplatePicker.vue";
import type { SurveyTemplate } from "../lib/templates.js";

const { t } = useI18n();
const host = useSurveysHost();
const notify = useSurveysNotify();
const surveysApi = useSurveysApi();

const items = ref<SurveySummary[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const search = ref("");
const statusFilter = ref<"all" | SurveyStatus>("all");
const createOpen = ref(false);
const newTitle = ref("");
const templateOpen = ref(false);
const templateBusy = ref(false);

// survey_create 交付帧 → 载荷交接给工作区（落地提示卡）+ toast + 导航。
const copilotHandlers: SurveysCopilotHandlers = {
  onSurveyDeliveryFrame: (delivery) => {
    if (delivery.type !== "survey_create") return;
    setAiCreatedSurveyHandoff(delivery);
    notify.success(t("surveys.copilot.created", { title: delivery.title }));
    host.navigate({ name: "surveys.detail", surveyId: delivery.surveyId });
  },
};
const unregisterCopilotHandlers = host.copilot?.registerHandlers(copilotHandlers);
onUnmounted(() => unregisterCopilotHandlers?.());

function openAiGenerate() {
  host.copilot?.fillComposer(t("surveys.copilot.generateTemplate"));
  host.copilot?.focusComposer();
}

const statusOptions = computed(() => [
  { value: "all" as const, label: t("surveys.filterAll") },
  { value: "draft" as const, label: t("surveys.status.draft") },
  { value: "published" as const, label: t("surveys.status.published") },
  { value: "paused" as const, label: t("surveys.status.paused") },
  { value: "closed" as const, label: t("surveys.status.closed") },
]);

const filtered = computed(() => {
  const term = search.value.trim().toLocaleLowerCase();
  return items.value.filter((item) => {
    const statusOk =
      statusFilter.value === "all" || item.status === statusFilter.value;
    const termOk = !term || item.title.toLocaleLowerCase().includes(term);
    return statusOk && termOk;
  });
});

function errorMessage(): string {
  return t("surveys.requestFailed");
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    items.value = (await surveysApi.list()).items;
  } catch (e) {
    error.value = errorMessage();
  } finally {
    loading.value = false;
  }
}

async function create() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const next = await surveysApi.create(newTitle.value.trim());
    createOpen.value = false;
    newTitle.value = "";
    host.navigate({ name: "surveys.detail", surveyId: next.id });
  } catch {
    error.value = errorMessage();
  } finally {
    busy.value = false;
  }
}

// 模板建卷（issue #217）：走既有 create + save 草稿通道——创建后立即把模板
// 定义存为草稿 v1（幂等：同一模板重复选择总是得到独立的新问卷），标题可改。
async function createFromTemplate(template: SurveyTemplate) {
  if (templateBusy.value) return;
  templateBusy.value = true;
  error.value = "";
  try {
    const created = await surveysApi.create(template.definition.title);
    await surveysApi.save(created.id, created.draftVersion, template.definition);
    templateOpen.value = false;
    host.navigate({ name: "surveys.detail", surveyId: created.id });
  } catch {
    error.value = errorMessage();
  } finally {
    templateBusy.value = false;
  }
}

function severity(status: string) {
  return status === "published"
    ? "success"
    : status === "paused"
      ? "warn"
      : "secondary";
}

function openSurvey(id: string) {
  host.navigate({ name: "surveys.detail", surveyId: id });
}

onMounted(load);
</script>
<template>
  <main class="tw:flex tw:h-full tw:min-h-0 tw:flex-col">
    <SurveyPageHeader :title="t('surveys.heading')">
      <template #icon><ClipboardList :size="16" /></template>
      <template #actions>
        <Button
          :label="t('surveys.copilot.generate')"
          icon="pi pi-sparkles"
          severity="secondary"
          @click="openAiGenerate"
        />
        <Button
          :label="t('surveys.templates.pick')"
          icon="pi pi-clone"
          severity="secondary"
          @click="templateOpen = true"
        />
        <Button
          :label="t('surveys.create')"
          icon="pi pi-plus"
          @click="createOpen = true"
        />
      </template>
    </SurveyPageHeader>
    <div class="tw:min-h-0 tw:flex-1 tw:overflow-y-auto">
    <div
      class="tw:mx-auto tw:flex tw:max-w-3xl tw:flex-col tw:gap-5 tw:px-4 tw:py-6 tw:md:px-6"
    >
      <div class="mw-toolbar tw:flex tw:flex-wrap tw:items-center tw:gap-1.5">
        <IconField class="tw:w-60">
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="search"
            :placeholder="t('surveys.searchPlaceholder')"
            :aria-label="t('surveys.searchPlaceholder')"
            class="tw:w-full"
          />
        </IconField>
        <div
          class="tw:flex tw:flex-wrap tw:items-center tw:gap-1"
          role="group"
          :aria-label="t('surveys.statusFilter')"
        >
          <Button
            v-for="option in statusOptions"
            :key="option.value"
            class="filter-option"
            :label="option.label"
            severity="secondary"
            :variant="statusFilter === option.value ? undefined : 'text'"
            :aria-pressed="statusFilter === option.value"
            @click="statusFilter = option.value"
          />
        </div>
      </div>

      <Message v-if="error && items.length" severity="error" :closable="false">
        {{ error }}
        <Button :label="t('surveys.reload')" text @click="load" />
      </Message>

      <AsyncSlot
        :status="
          loading
            ? 'loading'
            : error && !items.length
              ? 'error'
              : !items.length
                ? 'empty'
                : 'ready'
        "
        skeleton="list"
        empty-title="surveys.empty"
        empty-hint="surveys.emptyHint"
        error-title="surveys.requestFailed"
        @retry="load"
      >
        <template #empty-action>
          <div class="tw:flex tw:flex-wrap tw:items-center tw:justify-center tw:gap-2">
            <Button
              :label="t('surveys.create')"
              icon="pi pi-plus"
              @click="createOpen = true"
            />
            <Button
              :label="t('surveys.templates.pick')"
              icon="pi pi-clone"
              severity="secondary"
              @click="templateOpen = true"
            />
          </div>
        </template>
        <p
          v-if="items.length && !filtered.length"
          class="tw:m-0 tw:p-4 tw:text-center tw:text-sm tw:text-muted"
        >
          {{ t("surveys.noMatch") }}
        </p>
        <div v-else-if="filtered.length" class="mw-group-card">
          <button
            v-for="(item, index) in filtered"
            :key="item.id"
            type="button"
            :style="{ '--mw-card-i': index }"
            class="survey-row tw:text-default"
            @click="openSurvey(item.id)"
          >
            <div class="survey-row-main">
              <strong class="tw:block tw:truncate tw:text-[15px] tw:font-semibold">
                {{ item.title }}
              </strong>
              <p class="tw:m-0 tw:mt-1.5 tw:text-[11px] tw:text-faint tw:tabular-nums">
                {{ t("surveys.responsesCount", { n: item.completedCount }) }} ·
                {{ new Date(item.updatedAt).toLocaleDateString() }}
              </p>
            </div>
            <Tag
              :value="t(`surveys.status.${item.status}`)"
              :severity="severity(item.status)"
            />
            <i class="pi pi-angle-right tw:text-faint" />
          </button>
        </div>
      </AsyncSlot>
    </div>
    </div>
  </main>
  <Dialog
    v-model:visible="createOpen"
    modal
    :header="t('surveys.create')"
    class="survey-dialog"
  >
    <label class="dialog-field">
      {{ t("surveys.title") }}
      <InputText
        v-model="newTitle"
        autofocus
        :maxlength="200"
        @keyup.enter="newTitle.trim() && create()"
      />
    </label>
    <template #footer>
      <Button
        :label="t('surveys.cancel')"
        text
        severity="secondary"
        @click="createOpen = false"
      />
      <Button
        :label="t('surveys.create')"
        :disabled="!newTitle.trim()"
        :loading="busy"
        @click="create"
      />
    </template>
  </Dialog>
  <SurveyTemplatePicker
    :visible="templateOpen"
    :busy="templateBusy"
    @update:visible="templateOpen = $event"
    @select="createFromTemplate"
  />
</template>
<style scoped>
.survey-row {
  display: flex;
  width: 100%;
  position: relative;
  align-items: center;
  gap: var(--layout-card-padding);
  padding: 12px 16px;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  animation: mw-card-in var(--motion-duration-spatial) var(--motion-ease-emphasized) both;
  animation-delay: calc(min(var(--mw-card-i, 0), 8) * 48ms);
  transition: background-color var(--motion-duration-fast) var(--motion-ease-standard);
}
.survey-row + .survey-row::before {
  content: "";
  position: absolute;
  top: 0;
  left: 1rem;
  right: 1rem;
  height: 1px;
  background: var(--color-border-subtle);
}
.survey-row:hover {
  background: var(--color-bg-soft);
}
.survey-row:focus-visible {
  outline: none;
  box-shadow: var(--effect-focus-ring);
}
.survey-row-main {
  flex: 1;
  min-width: 0;
}
.dialog-field {
  display: grid;
  gap: 0.5rem;
}
:global(.survey-dialog) {
  width: min(30rem, calc(100vw - 2rem));
}
@media (prefers-reduced-motion: reduce) {
  .survey-row {
    animation: none;
    transition: none;
  }
}
</style>
