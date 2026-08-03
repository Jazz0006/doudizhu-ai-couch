import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VoiceControl } from "./VoiceControl";

describe("VoiceControl", () => {
  it("starts disconnected without claiming that recognition is available", () => {
    const html = renderToStaticMarkup(<VoiceControl />);

    expect(html).toContain("完整本地语音");
    expect(html).toContain("本地语音未连接");
    expect(html).toContain("开启语音");
    expect(html).toContain("教练性格");
    expect(html).toContain("直接型");
    expect(html).toContain("陪练型");
    expect(html).toContain("分析型");
    expect(html).not.toContain("正在识别");
  });
});
