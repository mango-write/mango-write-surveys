import { SURVEY_LIMITS, type SurveyDefinition } from "../core/index.js";
import { hasUnverifiedConsentClaim } from "./consent-evidence.js";
import { hasExplicitTimeBudget, parseWrittenMinutes, WRITTEN_MINUTES } from "./time-budget.js";

const PERIOD = /(?:过去|最近|近|未来|今后|接下来)\s*(?:\d+|[一二三四五六七八九十两半]+)\s*(?:个)?(?:天|周|月|学期|季度|年)|(?:本周|本月|本学期|今年|去年|明年|下周|下个月)|(?:last|past|next)\s+(?:\d+|one|two|three|six|twelve)\s+(?:days?|weeks?|months?|years?)/gi;
const INSTITUTION = /[\u3400-\u9fff]{2,16}(?:大学|学院|研究院)/g;

function assignMissingIds(items: unknown, prefix: string): unknown {
  if (!Array.isArray(items)) return items;
  const occupied = new Set(items.flatMap((item) => item && typeof item === "object" && typeof item.id === "string" ? [item.id] : []));
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || item.id !== undefined) return item;
    let suffix = index + 1;
    while (occupied.has(`${prefix}${suffix}`)) suffix++;
    const id = `${prefix}${suffix}`;
    occupied.add(id);
    return { ...item, id };
  });
}

export function normalizeGeneratedFields(raw: Record<string, unknown>): Record<string, unknown> {
  const questions = assignMissingIds(raw.questions, "q");
  return {
    ...raw,
    ...(raw.version === undefined ? { version: 1 } : {}),
    ...(raw.description === undefined ? { description: "" } : {}),
    ...(raw.consent === undefined ? { consent: "" } : {}),
    ...(Array.isArray(questions) ? { questions: questions.map((item) => {
      if (!item || typeof item !== "object") return item;
      const question = item as Record<string, unknown>;
      return { ...question, ...(question.required === undefined ? { required: false } : {}),
        ...(question.options === undefined ? {} : { options: assignMissingIds(question.options, "o") }),
        ...(question.rows === undefined ? {} : { rows: assignMissingIds(question.rows, "r") }),
        ...(question.columns === undefined ? {} : { columns: assignMissingIds(question.columns, "c") }),
        ...(question.items === undefined ? {} : { items: assignMissingIds(question.items, "i") }) };
    }) } : {}),
    ...(raw.pages === undefined ? {} : { pages: assignMissingIds(raw.pages, "p") }),
  };
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

function periodKey(value: string): string {
  const compact = value.toLowerCase().replace(/\s/g, "");
  const current: Record<string, string> = { 本周: "current-week", 本月: "current-month", 本学期: "current-term", 今年: "current-year", 去年: "previous-year" };
  if (current[compact]) return current[compact]!;
  const match = compact.match(/^(过去|最近|近|last|past|未来|今后|接下来|next)(\d+|[一二三四五六七八九十两半]+|one|two|three|six|twelve)(?:个)?(天|周|月|学期|季度|年|days?|weeks?|months?|years?)$/);
  if (!match) return compact;
  const numbers: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十二: 12, one: 1, two: 2, three: 3, six: 6, twelve: 12 };
  let number = match[2] === "半" ? 0.5 : (numbers[match[2]!] ?? Number(match[2]));
  let unit = match[3]!;
  if (unit === "年" || /^years?$/.test(unit)) { number *= 12; unit = "month"; }
  else if (unit === "季度") { number *= 3; unit = "month"; }
  else if (unit === "月" || /^months?$/.test(unit)) unit = "month";
  else if (unit === "周" || /^weeks?$/.test(unit)) unit = "week";
  else if (unit === "天" || /^days?$/.test(unit)) unit = "day";
  return `${/^(?:未来|今后|接下来|next)$/.test(match[1]!) ? "future:" : "past:"}${number}:${unit}`;
}

export function unverifiedGeneratedPeriod(definition: SurveyDefinition, userTexts: readonly string[]): string | null {
  const sourcePeriods = userTexts.flatMap((text) => [...text.matchAll(PERIOD)].filter((match) =>
    !/(?:不|未|无|不要|不能|无需).{0,6}$/.test(text.slice(Math.max(0, match.index! - 10), match.index))).map((match) => periodKey(match[0])));
  const design = definition.researchDesign;
  const texts = [definition.description, definition.consent, ...definition.questions.flatMap(strings), ...definition.pages.flatMap(strings),
    ...(design ? [design.researchQuestion, design.population, design.recruitment, design.analysisPlan, ...design.assumptions,
      ...design.constructs.flatMap((construct) => [construct.label, construct.definition])] : [])];
  const periods = texts.flatMap((text) => [...text.matchAll(PERIOD)].map((match) => match[0]));
  return periods.find((period) => !sourcePeriods.includes(periodKey(period))) ?? null;
}

export function unverifiedGeneratedInstitution(definition: SurveyDefinition, userTexts: readonly string[]): string | null {
  const texts = strings(definition);
  const known = userTexts.flatMap((text) => [...text.matchAll(INSTITUTION)].filter((match) =>
    !/(?:不|非|未|无|不要|不是|并非).{0,16}$/.test(text.slice(Math.max(0, match.index! - 10), match.index! + match[0].length))).map((match) => match[0]));
  const names = texts.flatMap((text) => [...text.matchAll(INSTITUTION)].map((match) => match[0])).filter((name) => name.length >= 5 &&
    !/(?:所在|不同|多个|各个|各|本|该|某|全校|校内|学校|院系|哪些|哪个|所属|自己|我们|其他|目前|所有)(?:大学|学院|研究院)$/.test(name));
  return names.find((name) => !known.some((item) => name.endsWith(item) || item.endsWith(name))) ?? null;
}

export function stripUnverifiedParticipationText(definition: SurveyDefinition, userTexts: readonly string[]): { privacy: boolean; duration: boolean } {
  let privacy = false, duration = false;
  const filter = (text: string) => (text.match(/[^，,。；;！？!?\n]+[，,。；;！？!?\n]?/g) ?? []).filter((sentence) => {
    const hasPrivacy = hasUnverifiedConsentClaim(sentence, userTexts);
    const estimates = [...sentence.matchAll(new RegExp(`(${WRITTEN_MINUTES})\\s*(?:[-–—~至]\\s*(${WRITTEN_MINUTES})\\s*)?(?:分钟|minutes?|mins?)`, "gi"))];
    const vague = sentence.match(/几分钟|数分钟|a few minutes/i)?.[0];
    const hasDuration = /预计|约|大约|需要|用时|耗时|完成|填写|作答|survey|take|complete|finish/i.test(sentence) &&
      (estimates.some((match) => [match[1], match[2]].filter(Boolean).some((value) => {
        const minutes = parseWrittenMinutes(value!);
        return minutes === null || !hasExplicitTimeBudget(minutes, userTexts);
      })) || (!!vague && !userTexts.some((text) => text.toLowerCase().includes(vague.toLowerCase()))));
    privacy ||= hasPrivacy;
    duration ||= hasDuration;
    return !hasPrivacy && !hasDuration;
  }).join("").trim();
  definition.description = filter(definition.description);
  definition.consent = filter(definition.consent);
  for (const question of definition.questions) if (question.type === "statement") { question.body = filter(question.body); question.title = filter(question.title); }
  if (definition.researchDesign) {
    definition.researchDesign.recruitment = filter(definition.researchDesign.recruitment);
    definition.researchDesign.assumptions = definition.researchDesign.assumptions.map(filter).filter(Boolean);
    if (privacy && definition.researchDesign.pendingDecisions.length < SURVEY_LIMITS.maxDesignNotes && !definition.researchDesign.pendingDecisions.includes("数据处理方式待确认")) {
      definition.researchDesign.pendingDecisions.push("数据处理方式待确认");
    }
  }
  return { privacy, duration };
}

function mentionsConfirmedPostgraduate(userTexts: readonly string[]): boolean {
  return userTexts.some((text) => [...text.matchAll(/(?:研究生|硕士|博士|专硕|学硕|postgraduate|graduate student|master.?s student|ph\.?d)/gi)].some((match) =>
    !/(?:不|非|未|不要|不是|并非|不含|不包括|not|without|exclude)\s*[^。！？!?\n]{0,8}$/i.test(text.slice(Math.max(0, match.index! - 16), match.index)) &&
    !/^[^。！？!?\n]{0,8}(?:吗|么|待确认|待定|未知)/.test(text.slice(match.index! + match[0].length, match.index! + match[0].length + 12))));
}

export function unverifiedPopulationScope(definition: SurveyDefinition, userTexts: readonly string[]): boolean {
  if (mentionsConfirmedPostgraduate(userTexts)) return false;
  const statedScope = [definition.title, definition.description, ...(definition.researchDesign?.assumptions ?? [])];
  if (statedScope.some((text) => /研究生|硕士|博士|postgraduate|graduate students?|ph\.?d/i.test(text))) return true;
  return definition.questions.some((question) => /读研|读博|(?:研究生|硕士|博士).{0,8}年级/i.test(question.title));
}

export function stripUnverifiedPopulation(definition: SurveyDefinition, userTexts: readonly string[]): boolean {
  const design = definition.researchDesign;
  if (!design || !/(?:研究生|硕士|博士|postgraduate|graduate student|master.?s student|ph\.?d)/i.test(design.population)) return false;
  if (mentionsConfirmedPostgraduate(userTexts)) return false;
  design.population = "";
  if (design.pendingDecisions.length < SURVEY_LIMITS.maxDesignNotes && !design.pendingDecisions.includes("目标人群待确认")) design.pendingDecisions.push("目标人群待确认");
  return true;
}

export function redundantConsentQuestion(definition: SurveyDefinition): string | null {
  return definition.questions.find((question) => {
    if (!/知情同意|自愿参与|同意参与|consent to participate|agree to participate/i.test(question.title)) return false;
    if (!("options" in question)) return false;
    return question.options.some((option) => /不同意|不愿意|拒绝|disagree|do not agree|decline/i.test(option.label));
  })?.id ?? null;
}

export function unmeasuredAnalysisGroup(definition: SurveyDefinition): string | null {
  const plan = definition.researchDesign?.analysisPlan ?? "";
  if (!/(?:按|根据|按照|依照).{0,6}年级/.test(plan)) return null;
  if (/(?:补充|增加|加入|获取).{0,8}年级|年级.{0,8}(?:待补充|尚未收集|需补充)/.test(plan)) return null;
  return definition.questions.some((question) => question.type !== "statement" && strings(question).some((text) => /年级/.test(text))) ? null : "年级";
}

export function unverifiedReliabilityClaim(definition: SurveyDefinition): string | null {
  const design = definition.researchDesign;
  const plan = design?.analysisPlan ?? "";
  if (!design || !/(?:Cronbach|克隆巴赫|内部一致性|α\s*系数|alpha\s*系数|信度(?:系数|分析|指标))/.test(plan)) return null;
  if (/(?:多题|两题及以上|至少两题|≥\s*2\s*题|两个及以上)/.test(plan)) return null;
  return design.constructs.find((construct) => construct.questionIds.length < 2)?.label ?? null;
}

export function unsupportedGroupComparison(definition: SurveyDefinition): string | null {
  const design = definition.researchDesign;
  const plan = design?.analysisPlan ?? "";
  if (!design || !/(?:按|根据|按照|依照).{0,6}年级/.test(plan) || !/(?:均值|平均值|t\s*检验|welch|显著)/i.test(plan)) return null;
  if (/(?:外部工具|不支持|仅作?描述|交叉表|方差分析|anova|kruskal|mann)/i.test(plan)) return null;
  const grade = definition.questions.find((question) => question.type !== "statement" && strings(question).some((text) => /年级/.test(text)));
  return grade && "options" in grade && grade.options.length > 2 ? "年级" : null;
}

export function normalizeResearchMappings(definition: SurveyDefinition): string[] {
  if (!definition.researchDesign) return [];
  const questions = new Set(definition.questions.filter((question) => question.type !== "statement").map((question) => question.id));
  const statements = new Set(definition.questions.filter((question) => question.type === "statement").map((question) => question.id));
  for (const construct of definition.researchDesign.constructs) construct.questionIds = construct.questionIds.filter((id) => !statements.has(id));
  const mapped = new Set(definition.researchDesign.constructs.flatMap((construct) => construct.questionIds));
  return [...questions].filter((id) => !mapped.has(id));
}

export function unknownResearchMappings(definition: SurveyDefinition): string[] {
  const questions = new Set(definition.questions.filter((question) => question.type !== "statement").map((question) => question.id));
  return [...new Set((definition.researchDesign?.constructs ?? []).flatMap((construct) => construct.questionIds).filter((id) => !questions.has(id)))];
}
