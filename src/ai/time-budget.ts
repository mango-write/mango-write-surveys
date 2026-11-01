function chineseNumber(value: number): string | null {
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value < 1 || value > 99 || !Number.isInteger(value)) return null;
  if (value < 10) return digits[value]!;
  const tens = Math.floor(value / 10);
  return `${tens === 1 ? "" : digits[tens]}十${digits[value % 10]}`;
}

const ENGLISH_NUMBERS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

export const WRITTEN_MINUTES = "(?:\\d+|[一二三四五六七八九十两]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";

export function parseWrittenMinutes(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  const english = ENGLISH_NUMBERS.indexOf(value.toLowerCase());
  if (english > 0) return english;
  for (let number = 1; number <= 99; number++) {
    if (chineseNumber(number) === value || (number === 2 && value === "两")) return number;
  }
  return null;
}

export function hasExplicitTimeBudget(minutes: number, userTexts: readonly string[]): boolean {
  const chinese = chineseNumber(minutes);
  const alternatives = [String(minutes), chinese, minutes === 2 ? "两" : null, ENGLISH_NUMBERS[minutes]].filter(Boolean).join("|");
  const number = `(?<![0-9一二三四五六七八九十两百])(?:${alternatives})(?![0-9一二三四五六七八九十两百])`;
  const duration = `${number}\\s*(?:分钟|分(?:钟)?|minutes?|mins?)`;
  const context = "(?:作答|答题|填写|填答|耗时|用时|时长|限时|不超过|最多|控制在|within|complete|finish|fill|survey)";
  const pattern = new RegExp(`(?:${context}.{0,12}${duration}|${duration}\\s*(?:内|以内|完成|填完|作答|问卷))`, "i");
  const negated = new RegExp(`(?:不需要|无需|不必|不是|不要|不用|do not|don't|not|without).{0,12}${duration}`, "i");
  return userTexts.some((text) => text.split(/[。！？!?;；\n]/).some((sentence) => {
    const normalized = sentence.replaceAll("不要超过", "不超过");
    return pattern.test(normalized) && !negated.test(normalized);
  }));
}
