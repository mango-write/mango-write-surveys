<script setup lang="ts">
// 问卷切换器（M2 补）：工作台标题区的轻量跨卷切换。不常驻第二份完整列表——
// 面板打开时才 api.list（结果缓存，重开不重拉），当前卷置顶并标记，支持按
// 标题过滤；选择沿用 host.navigate（未保存保护由既有路由守卫承担，这里不写
// 保存旁路），底部「查看全部问卷」直达列表页主入口。
// M3 评审修正：跨卷后缓存作废（currentId 变化即清，重开重拉）；当前卷不在
// api 返回里时只显示工作台标题，不虚构状态/计数；选中后立即收起面板。
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Popover from "primevue/popover";
import type { SurveySummary } from "../../contracts/index.js";
import { useSurveysApi } from "../api.js";
import { useSurveysHost } from "../host.js";

const props = defineProps<{ currentId: string; currentTitle: string }>();
const { t } = useI18n();
const api = useSurveysApi();
const host = useSurveysHost();

const panel = ref<{ toggle: (event: Event) => void; hide: () => void } | null>(null);
const items = ref<SurveySummary[]>([]);
const loading = ref(false);
const error = ref(false);
const search = ref("");
const opened = ref(false);
// 跨卷即作废缓存：换卷后旧列表可能已过时（新建/改名/删除），重开面板重拉。
watch(
  () => props.currentId,
  () => {
    items.value = [];
  },
);
/** 切换行只消费四个字段；api.list 可能不含刚建/刚改标题的当前卷——置顶并
 *  同步展示标题，状态/计数取不到就留空，不编造 draft/0。 */
interface SwitcherEntry {
  id: string;
  title: string;
  status: SurveySummary["status"] | null;
  completedCount: number | null;
}
const entries = computed<SwitcherEntry[]>(() => {
  const narrow = ({ id, title, status, completedCount }: SurveySummary): SwitcherEntry => ({ id, title, status, completedCount });
  const others = items.value.filter((item) => item.id !== props.currentId).map(narrow);
  const current = items.value.find((item) => item.id === props.currentId);
  return [
    current
      ? narrow(current)
      : { id: props.currentId, title: props.currentTitle, status: null, completedCount: null },
    ...others,
  ].map((entry) => (entry.id === props.currentId ? { ...entry, title: props.currentTitle || entry.title } : entry));
});
const filtered = computed(() => {
  const term = search.value.trim().toLocaleLowerCase();
  return entries.value
    .filter((item) => !term || item.title.toLocaleLowerCase().includes(term))
    .slice(0, 8);
});

async function load() {
  if (loading.value || items.value.length) return;
  loading.value = true;
  error.value = false;
  try {
    items.value = (await api.list()).items;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}
function toggle(event: Event) {
  panel.value?.toggle(event);
}
function select(id: string) {
  if (id === props.currentId) return;
  panel.value?.hide();
  host.navigate({ name: "surveys.detail", surveyId: id });
}
</script>
<template>
  <span class="survey-switcher">
    <Button :label="t('surveys.switcher.back')" text severity="secondary" class="switcher-action"
      @click="host.navigate({ name: 'surveys.list' })" />
    <Button :label="t('surveys.switcher.open')" icon="pi pi-chevron-down" icon-pos="right" text severity="secondary"
      class="switcher-action" :aria-expanded="opened" :aria-label="t('surveys.switcher.open')" @click="toggle" />
    <Popover ref="panel" :aria-label="t('surveys.switcher.open')" @show="opened = true; void load();" @hide="opened = false">
      <div class="switcher-panel">
        <InputText v-model="search" :placeholder="t('surveys.searchPlaceholder')"
          :aria-label="t('surveys.searchPlaceholder')" fluid />
        <Message v-if="error" severity="error" :closable="false">
          {{ t("surveys.requestFailed") }}
          <Button :label="t('surveys.reload')" text @click="items = []; load()" />
        </Message>
        <p v-else-if="loading" class="switcher-note" role="status">{{ t("surveys.switcher.loading") }}</p>
        <p v-else-if="!filtered.length" class="switcher-note">{{ t("surveys.switcher.noMatch") }}</p>
        <div v-else class="switcher-links">
          <Button v-for="item in filtered" :key="item.id" severity="secondary"
            :variant="item.id === currentId ? undefined : 'text'"
            :aria-current="item.id === currentId ? 'page' : undefined"
            @click="select(item.id)">
            <span class="switcher-item">
              <span class="switcher-title">{{ item.title || t("surveys.untitledSurvey") }}</span>
              <span v-if="item.status" class="switcher-meta">{{ t(`surveys.status.${item.status}`) }} · {{ t("surveys.responsesCount", { n: item.completedCount }) }}</span>
            </span>
          </Button>
        </div>
        <Button :label="t('surveys.switcher.all')" text severity="secondary"
          @click="host.navigate({ name: 'surveys.list' })" />
      </div>
    </Popover>
  </span>
</template>
<style scoped>
.survey-switcher { display: inline-flex; align-items: center; gap: .15rem; min-width: 0; }
.switcher-action { font-size: 12.5px; padding: .15rem .45rem; }
.switcher-panel { display: flex; flex-direction: column; gap: .5rem; width: 17rem; max-width: calc(100vw - 2.5rem); }
.switcher-panel :deep(.p-inputtext) { font-size: .85rem; padding-block: .35rem; }
.switcher-links { display: flex; flex-direction: column; }
.switcher-links > :deep(.p-button) { flex: none; min-height: 44px; justify-content: flex-start; padding: .5rem .6rem; text-align: start; white-space: normal; }
.switcher-item { display: flex; flex-direction: column; gap: .25rem; min-width: 0; }
.switcher-title { overflow-wrap: anywhere; line-height: 1.5; }
.switcher-meta { color: var(--color-text-tertiary); font-size: 12px; }
.switcher-note { margin: 0; color: var(--color-text-tertiary); font-size: .8rem; }
</style>
