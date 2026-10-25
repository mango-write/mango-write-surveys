import { describe, expect, it, vi } from "vitest";

import { extractTextWords } from "./text-words.js";

describe("extractTextWords", () => {
  it("uses real answer frequencies and filters non-word segments", () => {
    const words = extractTextWords(
      [
        { text: "Clear navigation, clear writing!", count: 2 },
        { text: "Helpful navigation and thoughtful writing", count: 1 },
      ],
      { locale: "en-US" },
    );
    expect(words).toEqual(
      expect.arrayContaining([
        { name: "navigation", value: 3 },
        { name: "writing", value: 3 },
        { name: "clear", value: 4 },
        { name: "helpful", value: 1 },
      ]),
    );
    expect(words.some((word) => word.name === "and")).toBe(false);
  });

  it("returns no cloud when there are too few useful unique words", () => {
    expect(
      extractTextWords([{ text: "good and clear", count: 1 }], { locale: "en-US" }),
    ).toEqual([]);
  });

  it("returns no cloud when Intl.Segmenter is unavailable", () => {
    const original = Intl.Segmenter;
    Object.defineProperty(Intl, "Segmenter", { value: undefined, configurable: true });
    expect(extractTextWords([{ text: "anything at all", count: 1 }])).toEqual([]);
    Object.defineProperty(Intl, "Segmenter", { value: original, configurable: true });
    vi.restoreAllMocks();
  });
});
