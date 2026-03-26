import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Mock child_process and fs before importing
jest.unstable_mockModule("node:child_process", () => ({
    execFileSync: jest.fn(),
}));

jest.unstable_mockModule("node:fs", () => ({
    existsSync: jest.fn(() => true),
    readdirSync: jest.fn(() => []),
    statSync: jest.fn(() => ({ isDirectory: () => true })),
    accessSync: jest.fn(),
    constants: { R_OK: 4 },
}));

const { execFileSync } = await import("node:child_process");
const fs = await import("node:fs");
const { runPreflight } = await import("../preflight.js");

import { makeOpts } from "./test-helpers.js";

describe("runPreflight", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default: target exists and is readable
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.accessSync as jest.Mock).mockReturnValue(undefined);
        (fs.readdirSync as jest.Mock).mockReturnValue([]);
        (fs.statSync as jest.Mock).mockReturnValue({ isDirectory: () => true });
    });

    it("passes for structural mode with valid target", () => {
        const result = runPreflight(makeOpts({ mode: "structural" }));
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("fails when target does not exist", () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        const result = runPreflight(makeOpts());
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain("Target not found");
    });

    it("fails when target is not readable", () => {
        (fs.existsSync as jest.Mock).mockImplementation((_path: unknown) => true);
        (fs.accessSync as jest.Mock).mockImplementation(() => {
            throw new Error("EACCES");
        });
        const result = runPreflight(makeOpts());
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain("Permission denied");
    });

    it("fails when no plugins found", () => {
        // existsSync returns true for target, false for plugin markers
        let callCount = 0;
        (fs.existsSync as jest.Mock).mockImplementation(() => {
            callCount++;
            return callCount <= 1; // true for target, false for everything else
        });
        (fs.accessSync as jest.Mock).mockReturnValue(undefined);
        const result = runPreflight(makeOpts());
        expect(result.ok).toBe(false);
        expect(result.errors.some((e: string) => e.includes("No plugin directories"))).toBe(true);
    });

    it("fails for integration+oauth when claude is not installed", () => {
        (execFileSync as jest.Mock).mockImplementation(() => {
            throw new Error("ENOENT");
        });
        const result = runPreflight(makeOpts({ mode: "integration", auth: "oauth" }));
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain("claude CLI not found");
    });

    it("passes for integration+oauth when claude exists", () => {
        (execFileSync as jest.Mock).mockReturnValue(Buffer.from("1.0.0"));
        const result = runPreflight(makeOpts({ mode: "integration", auth: "oauth" }));
        expect(result.ok).toBe(true);
    });

    it("fails for integration+api without API key", () => {
        const origKey = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        const result = runPreflight(makeOpts({ mode: "integration", auth: "api" }));
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain("ANTHROPIC_API_KEY");
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    });

    it("fails for integration+api with malformed API key", () => {
        const origKey = process.env.ANTHROPIC_API_KEY;
        process.env.ANTHROPIC_API_KEY = "bad-key";
        const result = runPreflight(makeOpts({ mode: "integration", auth: "api" }));
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain("sk-ant-");
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
        else delete process.env.ANTHROPIC_API_KEY;
    });

    it("skips claude check in dry-run mode", () => {
        (execFileSync as jest.Mock).mockImplementation(() => {
            throw new Error("ENOENT");
        });
        const result = runPreflight(makeOpts({ mode: "integration", auth: "oauth", dryRun: true }));
        expect(result.ok).toBe(true);
    });

    it("fails when prompts file does not exist", () => {
        // claude must be found on PATH for response-log mode to get past that check
        (execFileSync as jest.Mock).mockReturnValue(Buffer.from("1.0.0"));
        (fs.existsSync as jest.Mock).mockImplementation((p: unknown) => {
            return !(typeof p === "string" && p.includes("prompts"));
        });
        const result = runPreflight(
            makeOpts({ mode: "response-log", promptsFile: "/home/user/prompts.json" }),
        );
        expect(result.ok).toBe(false);
        expect(result.errors.some((e: string) => e.includes("Prompts file not found"))).toBe(true);
    });
});
