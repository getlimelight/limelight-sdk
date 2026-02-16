import { describe, it, expect, vi } from "vitest";
import { hasDOM, isServer } from "@/helpers";

describe("environment detection", () => {
  describe("hasDOM", () => {
    it("should return true in jsdom environment (window + document exist)", () => {
      expect(hasDOM()).toBe(true);
    });

    it("should return false when window is undefined", () => {
      const originalWindow = globalThis.window;

      delete (globalThis as any).window;

      expect(hasDOM()).toBe(false);

      (globalThis as any).window = originalWindow;
    });
  });

  describe("isServer", () => {
    it("should return false in jsdom environment", () => {
      expect(isServer()).toBe(false);
    });

    it("should return true when window is undefined", () => {
      const originalWindow = globalThis.window;

      delete (globalThis as any).window;

      expect(isServer()).toBe(true);

      (globalThis as any).window = originalWindow;
    });
  });
});
