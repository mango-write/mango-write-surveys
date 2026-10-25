// 问卷 UI 的通知出口：经宿主 notify 直通（toast 形态/位置/生命周期由宿主决定）。
// warn 未实现时回落 error：警示不能静默丢。
import { useSurveysHost } from "./host.js";

export function useSurveysNotify() {
  const { notify } = useSurveysHost();
  return {
    success: (detail: string) => notify.success(detail),
    error: (detail: string) => notify.error(detail),
    info: (detail: string) => notify.info(detail),
    warn: (detail: string) => (notify.warn ?? notify.error)(detail),
  };
}
