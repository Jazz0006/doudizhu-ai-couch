import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("renders the playable mobile table shell", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("练牌桌");
    expect(html).toContain("正在检查本地存档");
    expect(html).toContain("重新开局");
    expect(html).toContain("对手难度");
    expect(html).toContain("中等");
    expect(html).toContain("完整本地语音");
  });
});
