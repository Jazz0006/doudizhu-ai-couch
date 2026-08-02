import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createDeck } from "@ai-doudizhu/game-core";

import { PlayingCard } from "./PlayingCard";

describe("PlayingCard coach highlight", () => {
  it("renders coach highlighting separately from user selection", () => {
    const html = renderToStaticMarkup(
      <PlayingCard
        card={createDeck()[0]!}
        highlighted
        onClick={() => undefined}
      />,
    );

    expect(html).toContain("is-coach-highlighted");
    expect(html).not.toContain("is-selected");
    expect(html).toContain("教练高亮");
  });
});
