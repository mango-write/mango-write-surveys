<script setup lang="ts">
// 数据集导入对话框：本地 CSV → 表头预解析 + codebook 自动映射 → 人工确认
// 剩余映射与来源信息 → POST /api/research/datasets。权威解析在服务端；这里
// 只挡明显失败（超 5MiB、表头问题），保证用户提交前就知道哪里对不上。
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import FileUpload, { type FileUploadSelectEvent } from "primevue/fileupload";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Message from "primevue/message";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Tag from "primevue/tag";
import type { SurveyCodebook } from "../../contracts/index.js";
import { useSurveysApi } from "../api.js";
import { useSurveysNotify } from "../notify.js";
import {
  RESEARCH_CSV_MAX_BYTES,
  ResearchCsvError,
  autoMapColumns,
  findDuplicateColumn,
  parseCsvHead,
  type ParsedCsvHead,
} from "../lib/research-csv.js";

const props = defineProps<{
  surveyId: string;
  revisionId: string;
  canWrite: boolean;
  visible: boolean;
  variables: SurveyCodebook["variables"];
}>();
const emit = defineEmits<{
  "update:visible": [visible: boolean];
  created: [datasetId: string];
}>();
const { t } = useI18n();
const api = useSurveysApi();
const notify = useSurveysNotify();

const csvText = ref<string | null>(null);
const parsed = ref<ParsedCsvHead | null>(null);
const fileName = ref("");
const parseError = ref<ResearchCsvError["code"] | "too_large" | null>(null);
const name = ref("");
const sourceKind = ref<"public" | "synthetic">("public");
const sourceTitle = ref("");
const sourceCitation = ref("");
const sourceUrl = ref("");
const sourceLicense = ref("");
const sourceNote = ref("");
/** variableId → column（null = 不映射该变量）。 */
const mapping = ref<Map<string, string | null>>(new Map());
const busy = ref(false);

const sourceKindOptions = computed(() => [
  { value: "public" as const, label: t("surveys.research.sourcePublic") },
  { value: "synthetic" as const, label: t("surveys.research.sourceSynthetic") },
]);

function reset() {
  csvText.value = null;
  parsed.value = null;
  fileName.value = "";
  parseError.value = null;
  name.value = "";
  sourceKind.value = "public";
  sourceTitle.value = "";
  sourceCitation.value = "";
  sourceUrl.value = "";
  sourceLicense.value = "";
  sourceNote.value = "";
  mapping.value = new Map();
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) reset();
  },
);

async function readFile(event: FileUploadSelectEvent) {
  const file = event.files[0];
  parseError.value = null;
  parsed.value = null;
  csvText.value = null;
  if (!file) return;
  if (file.size > RESEARCH_CSV_MAX_BYTES) {
    parseError.value = "too_large";
    return;
  }
  try {
    const text = await file.text();
    const head = parseCsvHead(text);
    csvText.value = text;
    parsed.value = head;
    if (!name.value) name.value = file.name.replace(/\.csv$/i, "");
    const suggestions = autoMapColumns(props.variables, head.columns);
    mapping.value = new Map(
      suggestions.map((suggestion) => [suggestion.variableId, suggestion.column]),
    );
  } catch (err) {
    parseError.value =
      err instanceof ResearchCsvError ? err.code : "empty";
  }
}

/** 可选列 = 未被其他变量占用的列；已占用列从其它下拉里消失（不允许重复映射）。 */
function availableColumns(variableId: string) {
  const used = new Set(
    [...mapping.value].flatMap(([id, column]) =>
      id !== variableId && column ? [column] : [],
    ),
  );
  return (parsed.value?.columns ?? []).filter((column) => !used.has(column));
}

const mappedCount = computed(
  () => [...mapping.value.values()].filter(Boolean).length,
);
const duplicateColumn = computed(() =>
  findDuplicateColumn([...mapping.value].map(([variableId, column]) => ({ variableId, column }))),
);
const publicSourceIncomplete = computed(
  () =>
    sourceKind.value === "public" &&
    (!sourceTitle.value.trim() ||
      !sourceCitation.value.trim() ||
      !isValidUrl(sourceUrl.value.trim()) ||
      !sourceLicense.value.trim() ||
      !sourceNote.value.trim()),
);
const syntheticNoteMissing = computed(
  () => sourceKind.value === "synthetic" && !sourceNote.value.trim(),
);
const canSubmit = computed(
  () =>
    !busy.value &&
    !!props.canWrite &&
    !!csvText.value &&
    !!name.value.trim() &&
    mappedCount.value > 0 &&
    !duplicateColumn.value &&
    !publicSourceIncomplete.value &&
    !syntheticNoteMissing.value,
);

function isValidUrl(value: string) {
  try {
    return Boolean(new URL(value));
  } catch {
    return false;
  }
}

function parseErrorText() {
  const code = parseError.value;
  if (!code) return "";
  return t(`surveys.research.csvError.${code}`);
}

async function submit() {
  if (!canSubmit.value || !csvText.value) return;
  busy.value = true;
  try {
    const dataset = await api.research.createDataset({
      surveyId: props.surveyId,
      revisionId: props.revisionId,
      name: name.value.trim(),
      csv: csvText.value,
      mapping: [...mapping.value]
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([variableId, column]) => ({ variableId, column })),
      source:
        sourceKind.value === "public"
          ? {
              kind: "public",
              title: sourceTitle.value.trim(),
              citation: sourceCitation.value.trim(),
              url: sourceUrl.value.trim(),
              license: sourceLicense.value.trim(),
              note: sourceNote.value.trim(),
            }
          : {
              kind: "synthetic",
              title: sourceTitle.value.trim() || name.value.trim(),
              note: sourceNote.value.trim(),
            },
    });
    notify.success(t("surveys.research.importDone", { name: dataset.name }));
    emit("created", dataset.id);
    emit("update:visible", false);
  } catch {
    notify.error(t("surveys.research.importFailed"));
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Dialog
    :visible="visible"
    modal
    class="survey-dialog research-import-dialog"
    :header="t('surveys.research.importTitle')"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="import-body">
      <label
        >{{ t("surveys.research.pickFile") }}
        <FileUpload
          mode="basic"
          class="import-file"
          accept=".csv,text/csv"
          :max-file-size="RESEARCH_CSV_MAX_BYTES"
          :choose-label="t('surveys.research.pickFile')"
          choose-icon="pi pi-upload"
          :custom-upload="true"
          :auto="false"
          :disabled="!canWrite"
          @select="readFile"
        />
        <small v-if="parsed" class="tw:text-muted">{{
          t("surveys.research.fileParsed", {
            columns: parsed.columns.length,
            rows: parsed.rowCount,
          })
        }}</small>
        <small v-else-if="parseError" class="import-error">{{
          parseErrorText()
        }}</small>
        <small v-else class="tw:text-muted">{{
          t("surveys.research.pickFileHint")
        }}</small>
      </label>
      <template v-if="parsed">
        <label
          >{{ t("surveys.research.datasetName")
          }}<InputText v-model="name" fluid :maxlength="200"
        /></label>
        <div class="mapping-block">
          <p class="mapping-title">
            {{ t("surveys.research.mappingTitle", { n: mappedCount, total: variables.length }) }}
          </p>
          <Message
            v-if="duplicateColumn"
            severity="error"
            :closable="false"
            >{{
              t("surveys.research.mappingDuplicate", { column: duplicateColumn })
            }}</Message
          >
          <div class="mapping-list">
            <div
              v-for="variable in variables"
              :key="variable.id"
              class="mapping-row"
            >
              <span class="mapping-variable">
                {{ variable.label }}
                <code class="tw:text-muted">{{ variable.id }}</code>
              </span>
              <Select
                :model-value="mapping.get(variable.id) ?? null"
                :options="availableColumns(variable.id)"
                :placeholder="t('surveys.research.mappingNone')"
                :show-clear="true"
                fluid
                :aria-label="
                  t('surveys.research.mappingSelect', { label: variable.label })
                "
                @update:model-value="mapping.set(variable.id, $event ?? null)"
              />
            </div>
          </div>
        </div>
        <div class="source-block">
          <label
            >{{ t("surveys.research.sourceKind")
            }}<SelectButton
              v-model="sourceKind"
              :options="sourceKindOptions"
              option-label="label"
              option-value="value"
              :allow-empty="false"
              :aria-label="t('surveys.research.sourceKind')"
          /></label>
          <Message
            v-if="sourceKind === 'synthetic'"
            severity="warn"
            :closable="false"
            class="synthetic-notice"
            >{{ t("surveys.research.syntheticNotice") }}</Message
          >
          <label
            >{{ t("surveys.research.sourceTitle")
            }}<InputText v-model="sourceTitle" fluid :maxlength="500"
          /></label>
          <label
            >{{ t("surveys.research.sourceCitation")
            }}<Textarea v-model="sourceCitation" fluid :maxlength="2000" rows="2" auto-resize
          /></label>
          <label
            >{{ t("surveys.research.sourceUrl")
            }}<InputText v-model="sourceUrl" fluid :maxlength="2048"
          /></label>
          <label
            >{{ t("surveys.research.sourceLicense")
            }}<InputText v-model="sourceLicense" fluid :maxlength="200"
          /></label>
          <label
            >{{ t("surveys.research.sourceNote")
            }}<Textarea v-model="sourceNote" fluid :maxlength="2000" rows="3" auto-resize
          /></label>
          <small v-if="publicSourceIncomplete" class="import-error">{{
            t("surveys.research.publicSourceRequired")
          }}</small>
          <small v-else-if="syntheticNoteMissing" class="import-error">{{
            t("surveys.research.syntheticNoteRequired")
          }}</small>
        </div>
      </template>
    </div>
    <template #footer>
      <Tag
        v-if="sourceKind === 'synthetic'"
        :value="t('surveys.research.sourceSynthetic')"
        severity="warn"
      />
      <Button
        :label="t('surveys.cancel')"
        text
        severity="secondary"
        :disabled="busy"
        @click="emit('update:visible', false)"
      /><Button
        :label="t('surveys.research.importSubmit')"
        :disabled="!canSubmit"
        :loading="busy"
        @click="submit"
      />
    </template>
  </Dialog>
</template>
<style scoped>
.import-body {
  display: grid;
  gap: var(--layout-card-padding);
}
label {
  display: grid;
  gap: 0.5rem;
  width: 100%;
  min-width: 0;
}
.import-file,
.import-file :deep(.p-fileupload-choose-button) {
  width: 100%;
}
.import-error {
  color: var(--color-danger-700);
}
.mapping-block,
.source-block {
  display: grid;
  gap: 0.75rem;
}
.mapping-title {
  margin: 0;
  font-weight: 500;
}
.mapping-list {
  display: grid;
  gap: 0.5rem;
  max-height: 16rem;
  overflow-y: auto;
}
.mapping-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 14rem);
  gap: 0.75rem;
  align-items: center;
}
.mapping-variable {
  min-width: 0;
  overflow-wrap: anywhere;
}
.synthetic-notice {
  font-weight: 600;
}
@media (max-width: 600px) {
  .mapping-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
