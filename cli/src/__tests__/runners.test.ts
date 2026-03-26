import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { StructuralResult, IntegrationResult } from "../types.js";

// Use fake timers to prevent withTimeout() from leaking real timers
jest.useFakeTimers();

// ── Mock child_process ────────────────────────────────────────────────

class MockProcess extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    stdin = null;
    pid = 1234;
    killed = false;

    kill = jest.fn();

    /** Simulate sending data chunks from stdout, then closing */
    feedLines(lines: string[]) {
        const data = lines.join("\n") + "\n";
        this.stdout.emit("data", Buffer.from(data));
    }

    feedRaw(raw: string) {
        this.stdout.emit("data", Buffer.from(raw));
    }

    close(code = 0) {
        this.emit("close", code);
    }
}

let mockProc: MockProcess;

jest.unstable_mockModule("node:child_process", () => ({
    spawn: jest.fn(() => {
        mockProc = new MockProcess();
        return mockProc as unknown as ChildProcess;
    }),
    execFileSync: jest.fn(() => ""),
}));

jest.unstable_mockModule("node:fs", () => ({
    existsSync: jest.fn(() => false),
    readFileSync: jest.fn(() => "[]"),
}));

const { runStructural, runIntegration } = await import("../runners.js");
const { spawn } = await import("node:child_process");

import { makeOpts } from "./test-helpers.js";

// ── Structural tests ──────────────────────────────────────────────────

describe("runStructural", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        // Clear any pending withTimeout timers from tests that don't call mockProc.close()
        jest.clearAllTimers();
    });

    it("spawns bash with correct arguments", () => {
        const results: StructuralResult[] = [];
        runStructural(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        expect(spawn).toHaveBeenCalledWith(
            "bash",
            expect.arrayContaining(["structural"]),
            expect.objectContaining({
                env: expect.objectContaining({ FORCE_COLOR: "0", TERM: "dumb" }),
                stdio: ["ignore", "pipe", "pipe"],
            }),
        );
    });

    it("includes --skip when specified", () => {
        runStructural(
            makeOpts({ skip: "foo,bar" }),
            () => {},
            () => {},
        );

        const args = (spawn as jest.Mock).mock.calls[0][1] as string[];
        expect(args).toContain("--skip");
        expect(args).toContain("foo,bar");
    });

    it("includes component flags", () => {
        runStructural(
            makeOpts({ components: ["skills", "hooks"] }),
            () => {},
            () => {},
        );

        const args = (spawn as jest.Mock).mock.calls[0][1] as string[];
        expect(args).toContain("--skills");
        expect(args).toContain("--hooks");
        expect(args).not.toContain("--commands");
    });

    it("parses TAP pass lines", async () => {
        const results: StructuralResult[] = [];
        const promise = runStructural(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines(["ok 1 - my-plugin: plugin.json exists"]);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            id: 1,
            verdict: "pass",
            label: "my-plugin: plugin.json exists",
            detail: "",
            component: "unknown",
        });
    });

    it("parses TAP fail lines with detail", async () => {
        const results: StructuralResult[] = [];
        const promise = runStructural(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines(["not ok 3 - my-plugin: plugin.json has name # Missing or empty"]);
        mockProc.close(1);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            id: 3,
            verdict: "fail",
            label: "my-plugin: plugin.json has name",
            detail: "Missing or empty",
            component: "unknown",
        });
    });

    it("parses WARN lines", async () => {
        const results: StructuralResult[] = [];
        const promise = runStructural(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines(["ok 6 - my-plugin: has version # WARN: Missing (recommended)"]);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            id: 6,
            verdict: "warn",
            label: "my-plugin: has version",
            detail: "Missing (recommended)",
            component: "unknown",
        });
    });

    it("parses SKIP lines", async () => {
        const results: StructuralResult[] = [];
        const promise = runStructural(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines(["ok 7 - my-plugin: hooks/ # SKIP: No hooks directory"]);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            id: 7,
            verdict: "skip",
            label: "my-plugin: hooks/",
            detail: "No hooks directory",
            component: "unknown",
        });
    });

    it("emits section events", async () => {
        const sections: string[] = [];
        const promise = runStructural(
            makeOpts(),
            () => {},
            (s) => sections.push(s),
        );

        mockProc.feedLines(["# === Plugin: my-plugin ===", "# --- Skills: my-plugin ---"]);
        mockProc.close(0);

        await promise;
        expect(sections).toEqual(["Plugin: my-plugin", "Skills: my-plugin"]);
    });

    it("sets component type from section headers", async () => {
        const results: StructuralResult[] = [];
        const promise = runStructural(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines([
            "# === Plugin: my-plugin ===",
            "ok 1 - my-plugin: plugin.json exists",
            "# --- Skills: my-plugin ---",
            "ok 2 - my-plugin/auth: SKILL.md exists",
            "# --- Commands: my-plugin ---",
            "ok 3 - my-plugin/cmd:deploy: has frontmatter",
            "# --- Agents: my-plugin ---",
            "ok 4 - my-plugin/agent:helper: has name",
            "# --- Hooks: my-plugin ---",
            "ok 5 - my-plugin: hooks valid",
        ]);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(5);
        expect(results[0].component).toBe("manifest");
        expect(results[1].component).toBe("skill");
        expect(results[2].component).toBe("command");
        expect(results[3].component).toBe("agent");
        expect(results[4].component).toBe("hook");
    });

    it("handles multiple results in one chunk", async () => {
        const results: StructuralResult[] = [];
        const promise = runStructural(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines([
            "ok 1 - test: first",
            "not ok 2 - test: second # Bad value",
            "ok 3 - test: third # WARN: Check this",
        ]);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(3);
        expect(results[0].verdict).toBe("pass");
        expect(results[1].verdict).toBe("fail");
        expect(results[2].verdict).toBe("warn");
    });

    it("handles partial line buffering across chunks", async () => {
        const results: StructuralResult[] = [];
        const promise = runStructural(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        // Simulate a line split across two data events
        mockProc.feedRaw("ok 1 - test: fir");
        mockProc.feedRaw("st\nok 2 - test: second\n");
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(2);
        expect(results[0].label).toBe("test: first");
        expect(results[1].label).toBe("test: second");
    });

    it("flushes remaining buffer on close", async () => {
        const results: StructuralResult[] = [];
        const promise = runStructural(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        // Send a line without trailing newline
        mockProc.feedRaw("ok 1 - test: last");
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0].label).toBe("test: last");
    });

    it("rejects on process error", async () => {
        const promise = runStructural(
            makeOpts(),
            () => {},
            () => {},
        );
        mockProc.emit("error", new Error("spawn ENOENT"));
        await expect(promise).rejects.toThrow("spawn ENOENT");
    });
});

// ── Integration tests ─────────────────────────────────────────────────

describe("runIntegration", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.clearAllTimers();
    });

    it("spawns bash with correct arguments", () => {
        runIntegration(
            makeOpts(),
            () => {},
            () => {},
        );

        const args = (spawn as jest.Mock).mock.calls[0][1] as string[];
        expect(args).toContain("integration");
        expect(args).toContain("--model");
        expect(args).toContain("haiku");
        expect(args).toContain("--max-turns");
        expect(args).toContain("5");
        expect(args).toContain("--timeout");
        expect(args).toContain("60");
        expect(args).toContain("--auth");
        expect(args).toContain("oauth");
    });

    it("includes optional flags when set", () => {
        runIntegration(
            makeOpts({ verbose: true, dryRun: true, stopOnFail: true, skip: "broken" }),
            () => {},
            () => {},
        );

        const args = (spawn as jest.Mock).mock.calls[0][1] as string[];
        expect(args).toContain("--verbose");
        expect(args).toContain("--dry-run");
        expect(args).toContain("--stop-on-fail");
        expect(args).toContain("--skip");
        expect(args).toContain("broken");
    });

    it("parses PASS result lines", async () => {
        const results: IntegrationResult[] = [];
        const promise = runIntegration(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines([
            'PASS [skill] [1/5] my-plugin/data-analysis trigger: "analyze this data"',
        ]);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            testId: "my-plugin/data-analysis",
            plugin: "my-plugin",
            name: "data-analysis",
            verdict: "pass",
            trigger: "analyze this data",
            type: "skill",
        });
    });

    it("parses FAIL result lines", async () => {
        const results: IntegrationResult[] = [];
        const promise = runIntegration(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines([
            'FAIL [command] [2/5] my-plugin/cmd:deploy trigger: "deploy to staging"',
        ]);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            verdict: "fail",
            name: "cmd:deploy",
            type: "command",
        });
    });

    it("parses WARN, ERR, SKIP verdicts", async () => {
        const results: IntegrationResult[] = [];
        const promise = runIntegration(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines([
            'WARN [skill] [1/3] p/skill-a "trigger"',
            'ERR  [skill] [2/3] p/skill-b "trigger"',
            'SKIP [hook] [3/3] p/skill-c "trigger"',
        ]);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(3);
        expect(results[0].verdict).toBe("warn");
        expect(results[1].verdict).toBe("error");
        expect(results[2].verdict).toBe("skip");
    });

    it("parses wrong-skill-loaded WARN with detail", async () => {
        const results: IntegrationResult[] = [];
        const promise = runIntegration(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines([
            'WARN [skill] [1/5] my-plugin/data-analysis loaded: data-analytics (expected: data-analysis) | trigger: "analyze data"',
        ]);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            testId: "my-plugin/data-analysis",
            verdict: "warn",
            trigger: "analyze data",
            type: "skill",
        });
        expect(results[0].detail).toContain("loaded:");
        expect(results[0].detail).toContain("data-analytics");
        expect(results[0].detail).toContain("expected:");
        expect(results[0].detail).toContain("data-analysis");
    });

    it("parses no-tag keyword-only WARN", async () => {
        const results: IntegrationResult[] = [];
        const promise = runIntegration(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines([
            'WARN [skill] [1/5] my-plugin/code-review (no tag, keyword match) | trigger: "review my code"',
        ]);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            testId: "my-plugin/code-review",
            verdict: "warn",
            trigger: "review my code",
        });
        expect(results[0].detail).toContain("keyword");
    });

    it("calls onTotal with total from result lines", async () => {
        const totals: number[] = [];
        const promise = runIntegration(
            makeOpts(),
            () => {},
            () => {},
            (t) => totals.push(t),
        );

        mockProc.feedLines(['PASS [skill] [1/12] p/s "trigger"']);
        mockProc.close(0);

        await promise;
        expect(totals).toContain(12);
    });

    it("calls onStart and onTotal for RUN lines", async () => {
        const starts: Array<[string, string]> = [];
        const totals: number[] = [];
        const promise = runIntegration(
            makeOpts(),
            () => {},
            (id, trigger) => starts.push([id, trigger]),
            (t) => totals.push(t),
        );

        mockProc.feedLines(['RUN [skill] [1/8] my-plugin/data-analysis "analyze my data"']);
        mockProc.close(0);

        await promise;
        expect(starts).toEqual([["my-plugin/data-analysis", "analyze my data"]]);
        expect(totals).toContain(8);
    });

    it("handles \\r\\033[K overwrite pattern (RUN then PASS on same line)", async () => {
        const results: IntegrationResult[] = [];
        const starts: Array<[string, string]> = [];
        const promise = runIntegration(
            makeOpts(),
            (r) => results.push(r),
            (id, trigger) => starts.push([id, trigger]),
        );

        // Simulate: RUN line, then \r\033[K, then PASS result — all on one line
        mockProc.feedLines([
            'RUN [skill] [1/5] p/s "go"\r\x1b[KPASS [skill] [1/5] p/s trigger: "go"',
        ]);
        mockProc.close(0);

        await promise;
        // Should parse the PASS from after the \r
        expect(results).toHaveLength(1);
        expect(results[0].verdict).toBe("pass");
        // RUN is in the first segment, but result match causes `continue`
        // so RUN is NOT parsed when a result is on the same line — this is expected
        // because the RUN was already superseded by the result
        expect(starts).toHaveLength(0);
    });

    it("strips ANSI escape codes from output", async () => {
        const results: IntegrationResult[] = [];
        const promise = runIntegration(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines(['\x1b[32mPASS\x1b[0m [skill] [1/3] p/s trigger: "test"']);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0].verdict).toBe("pass");
    });

    it("parses cost from result lines", async () => {
        const results: IntegrationResult[] = [];
        const promise = runIntegration(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines(['PASS [skill] [1/5] p/s "trigger" ($0.0012)']);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0].costUsd).toBeCloseTo(0.0012);
    });

    it("parses token usage from result lines", async () => {
        const results: IntegrationResult[] = [];
        const promise = runIntegration(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines([
            'PASS [skill] [1/5] p/s "trigger" ($0.0012) [tokens:1500/200/800/100]',
        ]);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0].tokens).toEqual({
            inputTokens: 1500,
            outputTokens: 200,
            cacheReadInputTokens: 800,
            cacheCreationInputTokens: 100,
        });
    });

    it("sets null tokens when no token tag present", async () => {
        const results: IntegrationResult[] = [];
        const promise = runIntegration(
            makeOpts(),
            (r) => results.push(r),
            () => {},
        );

        mockProc.feedLines(['PASS [skill] [1/5] p/s "trigger"']);
        mockProc.close(0);

        await promise;
        expect(results).toHaveLength(1);
        expect(results[0].tokens).toBeNull();
        expect(results[0].costUsd).toBe(0);
    });

    it("rejects on process error", async () => {
        const promise = runIntegration(
            makeOpts(),
            () => {},
            () => {},
        );
        mockProc.emit("error", new Error("spawn ENOENT"));
        await expect(promise).rejects.toThrow("spawn ENOENT");
    });
});
