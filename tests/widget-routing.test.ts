import { describe, expect, it } from "vitest";
import { redirectSystemPath } from "../app/src/app/+native-intent";

describe("widget system routing", () => {
  for (const initial of [true, false]) {
    it(`preserves snapshot context on ${initial ? "cold launch" : "warm tap"}`, () => {
      for (const path of ["agentnoticeboard:///page/tasks-2026.11.09", "agentnoticeboard://page/tasks-2026.11.09", "/page/tasks-2026.11.09"]) {
        expect(redirectSystemPath({ path, initial })).toBe("/page?id=tasks-2026.11.09");
      }
      // Every tap remains routable, including rapid repeat taps and a different snapshot.
      expect(redirectSystemPath({ path: "agentnoticeboard:///page/second", initial })).toBe("/page?id=second");
      expect(redirectSystemPath({ path: "agentnoticeboard:///page/tasks-2026.11.09", initial })).toBe("/page?id=tasks-2026.11.09");
    });
  }
  it("preserves pairing links and unrelated routes", () => {
    for (const path of ["agentnoticeboard:///pair?code=example", "/settings", "/"]) {
      expect(redirectSystemPath({ path, initial: true })).toBe(path);
    }
  });
});
