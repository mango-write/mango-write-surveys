import { defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useI18n } from "vue-i18n";

import { useSurveysHost } from "./host.js";
import { mountSurveyWidget, type SurveysHost } from "./mount.js";

const ProbeWidget = defineComponent({
  name: "ProbeWidget",
  props: {
    surveyTitle: { type: String, required: true },
  },
  setup(props) {
    const host = useSurveysHost();
    const { t } = useI18n();
    return () =>
      h("div", { class: "probe-widget" }, [
        h("span", { class: "probe-title" }, props.surveyTitle),
        h("span", { class: "probe-i18n" }, t("surveys.heading")),
        h(
          "button",
          {
            class: "probe-nav",
            onClick: () => host.navigate({ name: "surveys.list" }),
          },
          "go",
        ),
      ]);
  },
});

describe("mountSurveyWidget (dsh / non-Vue host seam)", () => {
  it("mounts a survey component into a raw HTMLElement, updates props, and disposes cleanly", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const navigate = vi.fn();
    const host: SurveysHost = {
      transport: {
        request: vi.fn(async () => ({ items: [] })) as never,
      },
      notify: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
      },
      navigate,
      renderMarkdown: (src) => src,
    };

    const mounted = mountSurveyWidget(container, {
      host,
      component: ProbeWidget,
      props: { surveyTitle: "Initial Survey" },
      locale: "en-US",
    });

    try {
      expect(container.querySelector(".probe-title")?.textContent).toBe("Initial Survey");
      expect(container.querySelector(".probe-i18n")?.textContent?.length).toBeGreaterThan(0);

      (container.querySelector(".probe-nav") as HTMLButtonElement).click();
      expect(navigate).toHaveBeenCalledWith({ name: "surveys.list" });

      mounted.updateProps({ surveyTitle: "Updated Survey" });
      await Promise.resolve();
      expect(container.querySelector(".probe-title")?.textContent).toBe("Updated Survey");
    } finally {
      mounted.dispose();
      // Idempotent second dispose
      mounted.dispose();
      expect(container.childNodes.length).toBe(0);
      container.remove();
    }
  });
});
