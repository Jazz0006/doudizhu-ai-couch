import { describe, expect, it } from "vitest";

import { serverPackageName } from "./index.js";

describe("server package", () => {
  it("exposes its scaffold identity", () => {
    expect(serverPackageName).toBe("@ai-doudizhu/server");
  });
});
