<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import type { SurveySummary } from "../../contracts/index.js";
import { useSurveysApi } from "../api.js";
import { useSurveysHost } from "../host.js";
const props = defineProps<{ currentId: string; currentTitle?: string }>();
const { t } = useI18n();
const api = useSurveysApi();
const host = useSurveysHost();
const items = ref<SurveySummary[]>([]);
const error = ref(false);
const loading = ref(false);
const creating = ref(false);
const title = ref("");
const busy = ref(false);
async function load() {
  loading.value = true;
  error.value = false;
  try { items.value = (await api.list()).items; }
  catch { error.value = true; }
  finally { loading.value = false; }
}
async function create() {
  if (busy.value) return;
  busy.value = true;
  try {
    const next = await api.create(title.value.trim());
    creating.value = false;
    title.value = "";
    host.navigate({ name: "surveys.detail", surveyId: next.id });
  } catch { error.value = true; }
  finally { busy.value = false; }
}
watch(() => props.currentId, load, { immediate: true });
</script>
<template>
  <nav class="survey-navigator" :aria-label="t('surveys.navigation.list')">
    <h2>{{ t("surveys.navigation.list") }}</h2>
    <Button :label="t('surveys.create')" icon="pi pi-plus" fluid @click="creating = !creating" />
    <form v-if="creating" class="create-form" @submit.prevent="create">
      <InputText v-model="title" :placeholder="t('surveys.title')" :aria-label="t('surveys.title')" fluid />
      <Button type="submit" :label="t('surveys.create')" :loading="busy" fluid />
    </form>
    <Button :label="t('surveys.navigation.all')" text @click="host.navigate({ name: 'surveys.list' })" />
    <Message v-if="error" severity="error" :closable="false">{{ t('surveys.requestFailed') }}<Button :label="t('surveys.reload')" text @click="load" /></Message>
    <p v-if="loading" role="status">{{ t('surveys.navigation.loading') }}</p>
    <p v-else-if="!items.length && !error">{{ t('surveys.navigation.empty') }}</p>
    <div class="survey-links">
      <Button v-for="item in items" :key="item.id" :label="(item.id === currentId ? currentTitle : item.title) || item.title || t('surveys.title')" :text="item.id !== currentId" :severity="item.id === currentId ? 'primary' : 'secondary'" :aria-current="item.id === currentId ? 'page' : undefined" @click="host.navigate({ name: 'surveys.detail', surveyId: item.id })" />
    </div>
  </nav>
</template>
<style scoped>
.survey-navigator, .create-form, .survey-links { display: flex; flex-direction: column; gap: .5rem; }
.survey-navigator { padding: .75rem; }
.survey-links { max-height: 35vh; overflow: auto; }
.survey-links :deep(.p-button) { justify-content: flex-start; text-align: left; }
.survey-links :deep(.p-button-label) { overflow-wrap: anywhere; }
h2 { margin: 0 0 .25rem; font-size: .875rem; }
p { color: var(--color-text-secondary); font-size: .875rem; }
</style>
