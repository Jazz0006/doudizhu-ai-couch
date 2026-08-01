import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("renders the playable mobile table shell", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("练牌桌");
    expect(html).toContain("要叫地主吗");
    expect(html).toContain("重新开局");
  });
});
