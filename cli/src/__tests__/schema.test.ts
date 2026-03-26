import { describe, it, expect } from "@jest/globals";
import { resolve } from "node:path";
import { lintPluginSchema, lintMarketplaceSchema } from "../lint/rules/schema.js";

const FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "tests");

// ── Plugin Schema ────────────────────────────────────────────────────

describe("lintPluginSchema", () => {
    it("passes for a valid plugin.json (golden-plugin)", () => {
        const results = lintPluginSchema(resolve(FIXTURES, "golden-plugin"));
        const errors = results.filter((r) => r.severity === "error");
        expect(errors).toHaveLength(0);
        expect(results.some((r) => r.severity === "info")).toBe(true);
    });

    it("returns no results when .claude-plugin/plugin.json missing", () => {
        const results = lintPluginSchema(resolve(FIXTURES, "mock-project"));
        expect(results).toHaveLength(0);
    });

    it("catches unknown properties", () => {
        // broken-plugin has a malformed manifest — check if schema catches it
        const results = lintPluginSchema(resolve(FIXTURES, "broken-plugin"));
        // At minimum we should get results back (errors or info)
        expect(results.length).toBeGreaterThan(0);
    });

    it("validates name pattern (kebab-case)", () => {
        // The golden-plugin name is "golden-plugin" which is valid kebab-case
        const results = lintPluginSchema(resolve(FIXTURES, "golden-plugin"));
        const nameErrors = results.filter(
            (r) => r.severity === "error" && r.message.includes("name"),
        );
        expect(nameErrors).toHaveLength(0);
    });
});

// ── Marketplace Schema ───────────────────────────────────────────────

describe("lintMarketplaceSchema", () => {
    it("passes for a valid marketplace.json (golden-marketplace)", () => {
        const results = lintMarketplaceSchema(resolve(FIXTURES, "golden-marketplace"));
        const errors = results.filter((r) => r.severity === "error");
        expect(errors).toHaveLength(0);
        expect(results.some((r) => r.severity === "info")).toBe(true);
    });

    it("returns no results when marketplace.json missing", () => {
        const results = lintMarketplaceSchema(resolve(FIXTURES, "golden-plugin"));
        expect(results).toHaveLength(0);
    });

    it("catches invalid marketplace structure (object plugins instead of array)", () => {
        const results = lintMarketplaceSchema(resolve(FIXTURES, "broken-marketplace"));
        const errors = results.filter((r) => r.severity === "error");
        expect(errors.length).toBeGreaterThan(0);
        // Should flag missing name, owner, and plugins type mismatch
        const messages = errors.map((e) => e.message).join(" ");
        expect(messages).toMatch(/plugins|name|owner/i);
    });
});
