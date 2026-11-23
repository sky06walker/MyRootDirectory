import { describe, expect, it } from "vitest";
import { ADMIN_ORIGIN, adminRedirectTarget } from "../src/utils/adminHost";

describe("adminRedirectTarget", () => {
  it("keeps the admin on the canonical host, previews and localhost", () => {
    expect(adminRedirectTarget("myrootdirectory.pages.dev")).toBeNull();
    expect(adminRedirectTarget("MyRootDirectory.pages.dev")).toBeNull();
    expect(adminRedirectTarget("abc123.myrootdirectory.pages.dev")).toBeNull();
    expect(adminRedirectTarget("localhost")).toBeNull();
    expect(adminRedirectTarget("127.0.0.1")).toBeNull();
    expect(adminRedirectTarget("[::1]")).toBeNull();
  });

  it("sends custom domains to the fixed admin URL", () => {
    const target = `${ADMIN_ORIGIN}/admin`;
    expect(adminRedirectTarget("myrootdirectory.cweihon.dpdns.org")).toBe(target);
    expect(adminRedirectTarget("example.org")).toBe(target);
  });

  it("does not trust look-alike hostnames", () => {
    const target = `${ADMIN_ORIGIN}/admin`;
    expect(adminRedirectTarget("myrootdirectory.pages.dev.evil.com")).toBe(target);
    expect(adminRedirectTarget("evilmyrootdirectory.pages.dev")).toBe(target);
    expect(adminRedirectTarget("localhost.evil.com")).toBe(target);
  });
});
