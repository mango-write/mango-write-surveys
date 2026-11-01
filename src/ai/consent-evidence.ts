const CLAIMS = [
  /匿名(?:化)?|anonym(?:ous|ized|ised|ity)/gi,
  /保密|confidential(?:ity)?/gi,
  /加密|encrypt(?:ed|ion)?/gi,
];

export function hasUnverifiedConsentClaim(consent: string, userTexts: readonly string[]): boolean {
  const source = userTexts.join("\n");
  const unsupportedRestriction = [...consent.matchAll(/(?:仅用于|只用于|仅供|不用于|不会用于|不收集|不会收集|不记录|不会记录|仅作|仅做|用于(?:学术|科研|教学|商业|课程)?研究(?!生)|用于(?:教学|商业|课程)(?:改进|分析|作业|目的)|用于[^，,。！？!?；;\n]{0,12}(?:交流|汇报|展示|发表|出版|论文|作业)|(?:结果|数据|答卷)[^，,。！？!?；;\n]{0,8}(?:向|给)[^，,。！？!?；;\n]{0,12}(?:汇报|展示|公开|分享|发表)|为[^，,。！？!?；;\n]{0,12}教学改进提供参考|不会带来(?:任何)?不利影响|不会受到(?:任何)?惩罚|no penalty|only used for|will not be used for|does not collect|will not collect)[^，,。！？!?；;\n]{0,80}/gi)].some((match) =>
    !userTexts.some((text) => {
      const index = text.toLowerCase().indexOf(match[0].toLowerCase());
      return index >= 0 && !/(?:不要|别|不许|禁止|勿|do not|don't).{0,8}$/i.test(text.slice(Math.max(0, index - 12), index));
    }));
  return unsupportedRestriction || CLAIMS.some((pattern) => {
    pattern.lastIndex = 0;
    if (!pattern.test(consent)) return false;
    pattern.lastIndex = 0;
    return ![...source.matchAll(pattern)].some((match) => {
      const preceding = source.slice(Math.max(0, match.index! - 12), match.index);
      const following = source.slice(match.index! + match[0].length, match.index! + match[0].length + 12);
      return !/(?:不|非|未|无法|不能|不要|并非|是否|能否|可否|可能|without|not|no|whether|maybe)\s*[^。！？!?\n]{0,8}$/i.test(preceding) &&
        !/^[^。！？!?\n]{0,8}(?:不确定|待确认|待定|未知|吗|么|是否|unknown)/i.test(following);
    });
  });
}
