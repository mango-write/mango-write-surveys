// 会话锚定行（给模型的领域提示，宿主作 ephemeral system 尾注注入；文字改动
// 会影响线上会话行为，改前先对齐问卷产品规格）。
import type { SurveysService } from "../server/service.js";

/** survey scope 会话的锚定行：告诉模型本会话锚定哪份问卷。live 注入不进缓存
 *  前缀（标题可改）；取不到不阻断。 */
export async function loadSurveyAnchorLine(
  service: SurveysService,
  userId: string,
  surveyId: string,
): Promise<string | null> {
  try {
    const survey = await service.requireSurveyAccess(userId, surveyId, "read");
    return (
      `本会话锚定问卷「${survey.title}」（surveyId: ${surveyId}，状态 ${survey.status}）。` +
      `改卷前先用 survey_read 读取页/题 id；修改走 survey_edit（自动应用到画布，用户可撤销）；` +
      `发布与收集状态没有工具，永远由用户手动操作。`
    );
  } catch {
    return null;
  }
}

/** surveys 模块级会话（问卷列表页右栏）的锚定行：只管出卷，无锚定资源。 */
export const SURVEYS_MODULE_ANCHOR_LINE =
  `本会话是问卷模块的对话（问卷列表页）：可以从零生成新问卷——survey_create 创建后自动在用户的工作区打开。` +
  `修改已有问卷不在本会话：请让用户进对应问卷的工作台，那里才有 survey_read / survey_edit。` +
  `发布与收集状态没有工具，永远由用户手动操作。`;
