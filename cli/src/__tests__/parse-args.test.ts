import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
// Mock existsSync before importing parseArgs
jest.unstable_mockModule("node:fs", () => ({
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => JSON.stringify({ version: "0.1.0" })),
}));

// Mock process.exit to prevent actual exits
const mockExit = jest.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit");
}) as never);

const mockLog = jest.spyOn(console, "log").mockImplementation(() => {});
const mockError = jest.spyOn(console, "error").mockImplementation(() => {});

const { parseArgs } = await import("../parse-args.js");

describe("parseArgs", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ── Help / Version ──────────────────────────────────────────────────

    describe("help and version", () => {
        it("shows help with --help", () => {
            expect(() => parseArgs(["node", "conform", "--help"])).toThrow("process.exit");
            expect(mockLog).toHaveBeenCalled();
            expect(mockLog.mock.calls[0][0]).toContain("USAGE");
            expect(mockExit).toHaveBeenCalledWith(0);
        });

        it("shows help with -h", () => {
            expect(() => parseArgs(["node", "conform", "-h"])).toThrow("process.exit");
            expect(mockExit).toHaveBeenCalledWith(0);
        });

        it("shows help with no args", () => {
            expect(() => parseArgs(["node", "conform"])).toThrow("process.exit");
            expect(mockLog).toHaveBeenCalled();
            expect(mockExit).toHaveBeenCalledWith(0);
        });

        it("shows version with --version", () => {
            expect(() => parseArgs(["node", "conform", "--version"])).toThrow("process.exit");
            expect(mockLog).toHaveBeenCalledWith("conform v0.1.0");
            expect(mockExit).toHaveBeenCalledWith(0);
        });
    });

    // ── Mode detection ──────────────────────────────────────────────────

    describe("mode detection", () => {
        it("defaults to 'all' when first arg is a path", () => {
            const opts = parseArgs(["node", "conform", "./my-plugin"]);
            expect(opts.mode).toBe("all");
            expect(opts.target).toBe("./my-plugin");
        });

        it("parses explicit structural mode", () => {
            const opts = parseArgs(["node", "conform", "structural", "./my-plugin"]);
            expect(opts.mode).toBe("structural");
            expect(opts.target).toBe("./my-plugin");
        });

        it("parses explicit integration mode", () => {
            const opts = parseArgs(["node", "conform", "integration", "./my-plugin"]);
            expect(opts.mode).toBe("integration");
        });

        it("parses explicit all mode", () => {
            const opts = parseArgs(["node", "conform", "all", "./my-plugin"]);
            expect(opts.mode).toBe("all");
        });

        it("exits with error for unknown mode and non-existent path", async () => {
            const fs = await import("node:fs");
            (fs.existsSync as jest.Mock).mockReturnValueOnce(false);
            expect(() => parseArgs(["node", "conform", "badmode"])).toThrow("process.exit");
            expect(mockError).toHaveBeenCalled();
            expect(mockExit).toHaveBeenCalledWith(1);
        });

        it("exits with error when mode given but no target", () => {
            expect(() => parseArgs(["node", "conform", "structural"])).toThrow("process.exit");
            expect(mockError).toHaveBeenCalled();
            expect(mockExit).toHaveBeenCalledWith(1);
        });
    });

    // ── Defaults ────────────────────────────────────────────────────────

    describe("defaults", () => {
        it("sets correct default values", () => {
            const opts = parseArgs(["node", "conform", "./my-plugin"]);
            expect(opts.model).toBe("haiku");
            expect(opts.maxTurns).toBe(5);
            expect(opts.timeout).toBe(60);
            expect(opts.verbose).toBe(false);
            expect(opts.dryRun).toBe(false);
            expect(opts.stopOnFail).toBe(false);
            expect(opts.skip).toBe("");
            expect(opts.report).toBe(false);
            expect(opts.reportDir).toBe("./reports");
            expect(opts.promptsFile).toBe("");
            expect(opts.json).toBe(false);
            expect(opts.ci).toBe(false);
        });

        it("defaults components to all four when none specified", () => {
            const opts = parseArgs(["node", "conform", "./my-plugin"]);
            expect(opts.components).toEqual(["skills", "commands", "agents", "hooks"]);
        });
    });

    // ── Component filters ──────────────────────────────────────────────

    describe("component filters", () => {
        it("parses --skills", () => {
            const opts = parseArgs(["node", "conform", "./p", "--skills"]);
            expect(opts.components).toEqual(["skills"]);
        });

        it("parses --commands", () => {
            const opts = parseArgs(["node", "conform", "./p", "--commands"]);
            expect(opts.components).toEqual(["commands"]);
        });

        it("parses --hooks", () => {
            const opts = parseArgs(["node", "conform", "./p", "--hooks"]);
            expect(opts.components).toEqual(["hooks"]);
        });

        it("parses --agents", () => {
            const opts = parseArgs(["node", "conform", "./p", "--agents"]);
            expect(opts.components).toEqual(["agents"]);
        });

        it("parses multiple component filters", () => {
            const opts = parseArgs(["node", "conform", "./p", "--skills", "--commands"]);
            expect(opts.components).toEqual(["skills", "commands"]);
        });
    });

    // ── Integration options ─────────────────────────────────────────────

    describe("integration options", () => {
        it("parses --model", () => {
            const opts = parseArgs(["node", "conform", "./p", "--model", "sonnet"]);
            expect(opts.model).toBe("sonnet");
        });

        it("parses --max-turns", () => {
            const opts = parseArgs(["node", "conform", "./p", "--max-turns", "10"]);
            expect(opts.maxTurns).toBe(10);
        });

        it("parses --timeout", () => {
            const opts = parseArgs(["node", "conform", "./p", "--timeout", "120"]);
            expect(opts.timeout).toBe(120);
        });

        it("parses --auth api", () => {
            const opts = parseArgs(["node", "conform", "./p", "--auth", "api"]);
            expect(opts.auth).toBe("api");
        });

        it("parses --auth oauth", () => {
            const opts = parseArgs(["node", "conform", "./p", "--auth", "oauth"]);
            expect(opts.auth).toBe("oauth");
        });
    });

    // ── General options ─────────────────────────────────────────────────

    describe("general options", () => {
        it("parses --skip", () => {
            const opts = parseArgs(["node", "conform", "./p", "--skip", "foo,bar"]);
            expect(opts.skip).toBe("foo,bar");
        });

        it("parses --verbose", () => {
            const opts = parseArgs(["node", "conform", "./p", "--verbose"]);
            expect(opts.verbose).toBe(true);
        });

        it("parses -v shorthand", () => {
            const opts = parseArgs(["node", "conform", "./p", "-v"]);
            expect(opts.verbose).toBe(true);
        });

        it("parses --dry-run", () => {
            const opts = parseArgs(["node", "conform", "./p", "--dry-run"]);
            expect(opts.dryRun).toBe(true);
        });

        it("parses --stop-on-fail", () => {
            const opts = parseArgs(["node", "conform", "./p", "--stop-on-fail"]);
            expect(opts.stopOnFail).toBe(true);
        });
    });

    // ── Report options ──────────────────────────────────────────────────

    describe("report options", () => {
        it("parses --report", () => {
            const opts = parseArgs(["node", "conform", "./p", "--report"]);
            expect(opts.report).toBe(true);
            expect(opts.reportDir).toBe("./reports");
        });

        it("parses --report-dir (implies --report)", () => {
            const opts = parseArgs(["node", "conform", "./p", "--report-dir", "./output"]);
            expect(opts.report).toBe(true);
            expect(opts.reportDir).toBe("./output");
        });

        it("parses --report with --report-dir", () => {
            const opts = parseArgs([
                "node",
                "conform",
                "./p",
                "--report",
                "--report-dir",
                "/home/user/reports",
            ]);
            expect(opts.report).toBe(true);
            expect(opts.reportDir).toBe("/home/user/reports");
        });
    });

    // ── Response log options ────────────────────────────────────────────

    describe("response-log options", () => {
        it("parses response-log mode", () => {
            const opts = parseArgs(["node", "conform", "response-log", "./p"]);
            expect(opts.mode).toBe("response-log");
        });

        it("parses --prompts", () => {
            const opts = parseArgs([
                "node",
                "conform",
                "response-log",
                "./p",
                "--prompts",
                "./tests.json",
            ]);
            expect(opts.promptsFile).toBe("./tests.json");
        });
    });

    // ── CI options ────────────────────────────────────────────────────

    describe("CI options", () => {
        it("parses --ci", () => {
            const opts = parseArgs(["node", "conform", "structural", "./p", "--ci"]);
            expect(opts.ci).toBe(true);
        });

        it("parses --ci with --stop-on-fail", () => {
            const opts = parseArgs(["node", "conform", "./p", "--ci", "--stop-on-fail"]);
            expect(opts.ci).toBe(true);
            expect(opts.stopOnFail).toBe(true);
        });

        it("parses --ci with --json", () => {
            const opts = parseArgs(["node", "conform", "structural", "./p", "--ci", "--json"]);
            expect(opts.ci).toBe(true);
            expect(opts.json).toBe(true);
        });
    });

    // ── Lint options ──────────────────────────────────────────────────

    describe("lint options", () => {
        it("parses lint mode", () => {
            const opts = parseArgs(["node", "conform", "lint", "./p"]);
            expect(opts.mode).toBe("lint");
        });

        it("parses --json", () => {
            const opts = parseArgs(["node", "conform", "lint", "./p", "--json"]);
            expect(opts.json).toBe(true);
        });

        it("parses lint with component filters", () => {
            const opts = parseArgs(["node", "conform", "lint", "./p", "--skills", "--hooks"]);
            expect(opts.mode).toBe("lint");
            expect(opts.components).toEqual(["skills", "hooks"]);
        });
    });

    // ── Combined flags ──────────────────────────────────────────────────

    describe("combined flags", () => {
        it("parses a complex command line", () => {
            const opts = parseArgs([
                "node",
                "conform",
                "integration",
                "./plugins",
                "--skills",
                "--commands",
                "--model",
                "opus",
                "--max-turns",
                "3",
                "--timeout",
                "30",
                "--skip",
                "broken",
                "--verbose",
                "--stop-on-fail",
                "--auth",
                "api",
            ]);
            expect(opts.mode).toBe("integration");
            expect(opts.auth).toBe("api");
            expect(opts.target).toBe("./plugins");
            expect(opts.components).toEqual(["skills", "commands"]);
            expect(opts.model).toBe("opus");
            expect(opts.maxTurns).toBe(3);
            expect(opts.timeout).toBe(30);
            expect(opts.skip).toBe("broken");
            expect(opts.verbose).toBe(true);
            expect(opts.stopOnFail).toBe(true);
        });
    });
});
