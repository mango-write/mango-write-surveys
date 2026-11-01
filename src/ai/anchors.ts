// 会话锚定行（给模型的领域提示，宿主作 ephemeral system 尾注注入；文字改动
// 会影响线上会话行为，改前先对齐问卷产品规格）。
import type { SurveysService } from "../server/service.js";

/** survey scope 会话的锚定行：告诉模型本会话锚定哪份问卷。live 注入不进缓存
 *  前缀（标题可改）；取不到不阻断。顺序固定：读全文 → 必要时补研究设计 →
 *  诊断（survey_review）→ 修订（survey_edit）。 */
export async function loadSurveyAnchorLine(
  service: SurveysService,
  userId: string,
  surveyId: string,
): Promise<string | null> {
  try {
    const survey = await service.requireSurveyAccess(userId, surveyId, "read");
    return (
      `本会话锚定问卷「${survey.title}」（surveyId: ${surveyId}，状态 ${survey.status}）。` +
      `动手前先用 survey_read 读完整定义、researchDesign 与标准索引；研究设计缺失时仅对会实质改变问卷的关键未知追问，` +
      `用 survey_edit 的 set_meta.researchDesign 补上（未知事实进 pendingDecisions，不编造人群、许可或验证状态）。` +
      `量表题（scale）生成或修订时两端锚点文案必填且语义对称（如 1=毫无提升 / 7=非常有提升），不得只写一端。` +
      `诊断：按标准区分「确定的问题 / 有依据的风险 / 待验证」，再用 survey_review 登记结构化诊断并给出可应用的建议；` +
      `AI 方法审查只是内部代理证据，不是真人预测试或效度验证，不得说问卷已验证或已通过。` +
      `修订走 survey_edit（自动应用到画布，用户可撤销）；发布与收集状态没有工具，永远由用户手动操作。` +
      `面向用户只说自然语言和下一步，不展示工具名、内部字段名或参数。`
    );
  } catch {
    return null;
  }
}

/** surveys 模块级会话（问卷列表页右栏）的锚定行：只管出卷，无锚定资源。 */
export const SURVEYS_MODULE_ANCHOR_LINE =
  `本会话是问卷模块的对话（问卷列表页）：可以从零生成新问卷。先利用用户已给的信息，只有关键未知会实质改变问卷时才追问；` +
  `一次只问当前最重要的取舍并给通俗选项，其余未知写进 pendingDecisions，不要编造。` +
  `不要把未确认的学校、机构、回忆期、数据用途、匿名方式或填写时长写成事实；只生成直接服务研究问题的必要题目，不把风险、行为、规范或背景另扩成用户未要求的主题。用户说小量表时保持精简，示例不是扩展研究范围的许可。` +
  `分析先考虑描述、分组或交叉表，其他方法需要适用条件；研究计划中如需宿主尚不支持的分析，应如实说明，不能声称产品能执行。` +
  `definition 带 researchDesign（研究设计依据），只有研究需要且依据充分时才填写 analysisModels；填写前已有参与同意勾选，不要再设计同意或拒绝参与的题目。survey_create 创建后自动在用户的工作区打开。` +
  `用户明确题数（如「8 题」）时在 survey_create 传 expectedQuestionCount 并让可答题数恰好相等（说明块不计入）；不符会在建卷前被拒，` +
  `按回执的实际题数补齐或删减后重试，不要少给；用户没给数字就不要猜题数。每道可答题关联研究用途，说明块不作答，不映射为题目。` +
  `修改与诊断已有问卷不在本会话：请让用户进对应问卷的工作台。` +
  `发布与收集状态没有工具，永远由用户手动操作。内部补字段、修正和重试不向用户播报；创建完成后用两三句自然语言说明结果、必要的未确认事项和下一步，不重复整份题目清单，不展示工具名、内部字段名或参数。回执指出未经确认的说明已移除时，应说尚未写入而不是说草稿中已标记。少量试填用于发现理解与流程问题，不称为检验信度或效度。`;
