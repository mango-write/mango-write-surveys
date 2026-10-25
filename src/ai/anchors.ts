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
      `动手前先用 survey_read 读完整定义、researchDesign 与标准索引；研究设计缺失时先问清研究问题/人群/用途，` +
      `用 survey_edit 的 set_meta.researchDesign 补上（未知事实进 pendingDecisions，不编造人群、许可或验证状态）。` +
      `诊断：按标准区分「确定的问题 / 有依据的风险 / 待验证」，再用 survey_review 登记结构化诊断并给出可应用的建议；` +
      `AI 方法审查只是内部代理证据，不是真人预测试或效度验证，不得说问卷已验证或已通过。` +
      `修订走 survey_edit（自动应用到画布，用户可撤销）；发布与收集状态没有工具，永远由用户手动操作。`
    );
  } catch {
    return null;
  }
}

/** surveys 模块级会话（问卷列表页右栏）的锚定行：只管出卷，无锚定资源。 */
export const SURVEYS_MODULE_ANCHOR_LINE =
  `本会话是问卷模块的对话（问卷列表页）：可以从零生成新问卷——先问清研究问题、目标人群与用途（不清楚就写进 pendingDecisions，不要编造），` +
  `definition 必须带 researchDesign（研究设计依据），survey_create 创建后自动在用户的工作区打开。` +
  `修改与诊断已有问卷不在本会话：请让用户进对应问卷的工作台，那里才有 survey_read / survey_edit / survey_review。` +
  `发布与收集状态没有工具，永远由用户手动操作。`;
