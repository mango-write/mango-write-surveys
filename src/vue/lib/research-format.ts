// 结果数值展示口径：统计量一律 4 位有效数字（与「不用懂 SPSS」的阅读密度
// 匹配）；null/NaN/±Infinity 归为不可计算（组件再映射成 locale 文案）。
export function isComputableNumber(value: string | number | null): value is number {
  return (
    typeof value === "number" && Number.isFinite(value)
  );
}

export function formatResearchNumber(value: string | number | null): string | null {
  if (typeof value === "string") return value;
  if (!isComputableNumber(value)) return null;
  const rounded = Number(value.toPrecision(4));
  return String(rounded === 0 ? 0 : rounded);
}
