import { getAllowedCorsHeaders } from "./cors-options.util";

describe("getAllowedCorsHeaders", () => {
  it("includes internal GC admin headers in the global CORS allowlist", () => {
    expect(getAllowedCorsHeaders()).toEqual([
      "Content-Type",
      "Authorization",
      "x-system-admin-token",
      "x-operator-id",
    ]);
  });
});
