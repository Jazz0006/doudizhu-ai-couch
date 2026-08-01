import { describe, expect, it } from "vitest";

import { sharedTypesPackageName } from "./index.js";

describe("shared-types package", () => {
  it("exposes its scaffold identity", () => {
    expect(sharedTypesPackageName).toBe("@ai-doudizhu/shared-types");
  });
});
