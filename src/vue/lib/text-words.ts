import type { TextEntry } from "./summary.js";

export interface TextWord {
  name: string;
  value: number;
}

const stopWords = new Set([
  "的", "了", "和", "是", "在", "我", "我们", "你", "你们", "他", "她", "它", "也", "都", "很", "就", "与", "及", "或", "而", "对", "为", "有", "没有", "一个", "一些", "可以", "觉得", "感觉", "希望", "比较", "非常", "真的", "这个", "那个", "因为", "所以", "如果", "但是", "还有", "应该", // i18n-allow: linguistic stop words
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "had", "has", "have", "i", "if", "in", "is", "it", "its", "me", "my", "no", "not", "of", "on", "or", "our", "so", "that", "the", "their", "them", "they", "this", "to", "too", "us", "was", "we", "were", "with", "you", "your",
]);

function usefulWord(segment: string): boolean {
  if (stopWords.has(segment)) return false;
  if (/\p{Script=Han}/u.test(segment)) return true;
  return /^[\p{L}\p{N}][\p{L}\p{N}'’-]+$/u.test(segment);
}

export function extractTextWords(
  entries: TextEntry[],
  options: { locale?: string; minUniqueWords?: number } = {},
): TextWord[] {
  if (typeof Intl.Segmenter !== "function") return [];
  const segmenter = new Intl.Segmenter(options.locale, { granularity: "word" });
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const part of segmenter.segment(entry.text)) {
      if (!part.isWordLike) continue;
      const word = part.segment.toLocaleLowerCase(options.locale).trim();
      if (!usefulWord(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + Math.max(1, entry.count));
    }
  }
  const minimum = options.minUniqueWords ?? 4;
  if (counts.size < minimum) return [];
  return Array.from(counts, ([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, 50);
}
