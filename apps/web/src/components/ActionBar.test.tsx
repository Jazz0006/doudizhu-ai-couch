import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ActionBar } from "./ActionBar";

describe("ActionBar", () => {
  it("offers a clear action whenever cards are selected", () => {
    const html = renderToStaticMarkup(
      <ActionBar
        canAct
        canClear
        canPass
        canPlay
        isFinished={false}
        onClear={vi.fn()}
        onHint={vi.fn()}
        onPass={vi.fn()}
        onPlay={vi.fn()}
        onRestart={vi.fn()}
      />,
    );

    expect(html).toContain("清空");
    expect(html).not.toContain("语音");
  });
});
