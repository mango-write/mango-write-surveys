import type { SurveyResearchResult, SurveyResearchTable } from "../contracts/index.js";

type Row = SurveyResearchTable["rows"][number];
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const format = (value: number) => value.toFixed(3);

function interval(row: Row, label: string): string | null {
  if (!number(row.estimate) || !number(row.ciLow) || !number(row.ciHigh)) return null;
  const excludesZero = row.ciLow > 0 || row.ciHigh < 0;
  return `${label}的估计为 ${format(row.estimate)}，95% 置信区间为 [${format(row.ciLow)}, ${format(row.ciHigh)}]。${excludesZero ? `区间不包含零，支持本模型下的${row.estimate > 0 ? "正向" : "负向"}统计关联` : "区间包含零，现有数据尚不能排除零效应"}；这不等于因果证据。`;
}

/** 仅解释固定结果，不推断未记录的研究假设、样本特征或因果机制。 */
export function describeResearchTable(table: SurveyResearchTable): string[] {
  switch (table.id) {
    case "reliability":
      return table.rows.map(row => number(row.rawAlpha)
        ? `${row.construct}包含 ${row.items} 个条目，有效 n=${row.n}，raw α=${format(row.rawAlpha)}。${row.rawAlpha < 0 ? "负 alpha 提示条目协变方向存在问题，应优先检查反向计分和条目内容" : "该数值描述本样本中条目的内部一致性，应结合条目内容、题数和用途判断"}，不能据此认定量表已获验证。`
        : `${row.construct}的 alpha 无法估计；应检查条目方差与有效数据，暂不评价其内部一致性。`);
    case "efa_fit": {
      const kmo = table.rows.find(row => row.statistic === "KMO")?.value;
      const p = table.rows.find(row => row.statistic === "Bartlett p")?.value;
      return [
        ...(number(kmo) ? [`KMO=${format(kmo)}，用于描述相关矩阵的因子分析适用性；需与共同度、条目内容一起判断。`] : []),
        ...(number(p) ? [`Bartlett 球形检验 ${p < .001 ? "p<0.001" : `p=${format(p)}`}，${p < .05 ? "在 0.05 水平拒绝单位相关矩阵假设，提示变量之间存在可供探索的相关结构" : "尚不能在 0.05 水平拒绝单位相关矩阵假设，提取因子应格外谨慎"}。检验本身不验证理论结构。`] : []),
      ];
    }
    case "efa_variance": {
      const values = table.rows.map(row => row.varianceExplained).filter(number);
      if (!values.length) return [];
      const total = values.reduce((sum, value) => sum + value, 0);
      return [`本次提取 ${values.length} 个因子，提取载荷平方和占题数的累计比例为 ${(total * 100).toFixed(1)}%。这是本次主轴因子解的描述，不能单凭累计比例确认因子数或理论模型。`];
    }
    case "efa_loadings": {
      const valid = table.rows.filter(row => number(row.communality));
      if (!valid.length) return [];
      const values = valid.map(row => row.communality as number);
      const lowest = valid.reduce((a, b) => (a.communality as number) < (b.communality as number) ? a : b);
      return [`题目共同度范围为 ${format(Math.min(...values))}–${format(Math.max(...values))}；其中 ${lowest.variable} 的共同度最低。结合热图检查主载荷、交叉载荷和条目含义，再决定是否调整条目；因子名称需要研究者依据理论确定。`];
    }
    case "coefficients":
    case "mediator_model":
    case "outcome_model":
      return table.rows.filter(row => !["intercept", "(intercept)"].includes(String(row.term).toLowerCase()))
        .flatMap(row => { const text = interval(row, String(row.term)); return text ? [text] : []; });
    case "conditional_indirect": {
      const conditions = table.rows.filter(row => /^W=/.test(String(row.effect)) && number(row.estimate));
      const difference = table.rows.find(row => row.effect === "高低条件差");
      const index = table.rows.find(row => row.effect === "调节中介指数 a×interaction");
      const values = conditions.map(row => row.estimate as number);
      const pattern = values.length === 3 && values[0]! < values[1]! && values[1]! < values[2]! ? "随 W 水平升高而递增" : values.length === 3 && values[0]! > values[1]! && values[1]! > values[2]! ? "随 W 水平升高而递减" : "在不同 W 水平下有所不同";
      return [
        ...(conditions.length ? [`${conditions.map(row => `${row.effect}=${format(row.estimate as number)}`).join("，")}。点估计${pattern}；这种数值趋势需要结合高低条件差和调节中介指数的区间判断，不能仅凭图中区间是否重叠得出差异结论。`] : []),
        ...[difference, index].flatMap(row => {
          if (!row) return [];
          const text = interval(row, String(row.effect));
          return text ? [text.replace("95% 置信区间", "percentile bootstrap 95% 置信区间")] : [];
        }),
      ];
    }
    case "simple_slopes":
      return table.rows.flatMap(row => { const text = interval(row, `W=${row.moderatorLevel} SD 时 M 的简单斜率`); return text ? [text] : []; });
    case "model_fit":
      return table.rows.filter(row => String(row.statistic).includes("R²") && number(row.value))
        .map(row => `${row.statistic}=${format(row.value as number)}。这是当前样本与模型下的拟合描述，不代表样本外预测能力，也不能解释为因果贡献率。`);
    default: return [];
  }
}

export function summarizeResearchResult(result: SurveyResearchResult): string[] {
  const primaryIds = ["reliability", "efa_variance", "coefficients", "conditional_indirect"];
  return result.tables.filter(table => primaryIds.includes(table.id)).flatMap(describeResearchTable);
}

export function discussResearchResult(result: SurveyResearchResult): string {
  const effects = result.tables.find(table => table.id === "conditional_indirect");
  if (effects) {
    const index = effects.rows.find(row => row.effect === "调节中介指数 a×interaction");
    const supported = index && number(index.ciLow) && number(index.ciHigh) && (index.ciLow > 0 || index.ciHigh < 0);
    return `本模型用第一路径系数与结果方程交互项的乘积描述间接效应随 W 的变化。${supported ? "本次调节中介指数的 bootstrap 区间不含零，为指定模型中的这种变化提供统计证据" : "本次调节中介指数的区间尚不能支持其偏离零，因此不能仅凭不同 W 水平下点估计的大小宣称调节中介成立"}。这一解释依赖变量计分、协变量选择与模型形式；未测量混杂或反向关系仍可能解释观察到的模式。`;
  }
  const reliability = result.tables.find(table => table.id === "reliability");
  if (reliability) {
    const rows = reliability.rows.filter(row => number(row.rawAlpha));
    if (rows.length) {
      const lowest = rows.reduce((a, b) => (a.rawAlpha as number) < (b.rawAlpha as number) ? a : b);
      return `本次信度比较中，${lowest.construct}的 raw α 最低（${format(lowest.rawAlpha as number)}）。后续可优先核对该构念的条目内容与反向计分，并结合用途评估测量误差；不能仅为了提高 alpha 删除题目。内部一致性也不能代替内容效度、结构证据或重测稳定性。`;
    }
  }
  if (result.tables.some(table => table.id === "efa_variance")) return "本次主轴因子分析给出当前样本中的探索性测量结构。载荷与共同度有助于定位题目和因子的关系，但因子数、命名与条目保留需要结合研究理论判断。若后续检验同一结构，应在独立样本中进行验证，避免将本次探索结果当作已确认的理论模型。";
  const coefficients = result.tables.find(table => table.id === "coefficients");
  if (coefficients) {
    const terms = coefficients.rows.filter(row => !["intercept", "(intercept)"].includes(String(row.term).toLowerCase()));
    const supported = terms.filter(row => number(row.ciLow) && number(row.ciHigh) && (row.ciLow > 0 || row.ciHigh < 0));
    return `本模型 ${terms.length} 个非截距项中，${supported.length} 项的 HC3 95% 置信区间不包含零。系数是在本次指定的其他预测变量保持不变时的统计关联，不能将系数大小直接比较为变量重要性，也不应用显著与否自动筛选解释变量。推广结论前仍需检查模型形式、残差与样本代表性。`;
  }
  return "本次结果仅描述固定输入与指定模型；应结合研究问题、测量质量和抽样设计评估结论适用范围。";
}
