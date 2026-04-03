import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliOptions, Mode, AuthMode, ReportType } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const USAGE = `
\x1b[1m\x1b[36mconform\x1b[0m — Claude Test Suite

\x1b[1mUSAGE\x1b[0m
  conform [mode] <target> [options]

\x1b[1mMODES\x1b[0m
  all              Structural + integration tests (default)
  structural       Static validation only — free, instant, no API
  integration      Integration tests only (use --auth to pick api or oauth)
  response-log     Run user-defined prompts and capture full responses
  lint             Fast structural linter — errors/warnings, JSON output

\x1b[1mTARGET\x1b[0m
  Path to a plugin directory, a folder of plugins, or a .claude directory.
  Plugin directories contain .claude-plugin/, skills/, commands/, agents/,
  or hooks/. A .claude directory (without a manifest) will validate any
  components found — commands, skills, agents, hooks in settings.json.

\x1b[1mCOMPONENT FILTERS\x1b[0m
  --skills           Only test skills
  --commands         Only test commands
  --hooks            Only test hooks
  --agents           Only test agents
                     (default: all components)

\x1b[1mINTEGRATION OPTIONS\x1b[0m
  --auth <mode>          Auth mode: api or oauth           (default: oauth)
  --model <name>         Model for integration tests       (default: haiku)
  --max-turns <n>        Max conversation turns per test   (default: 5)
  --timeout <secs>       Per-test timeout in seconds       (default: 60)

\x1b[1mRESPONSE LOG OPTIONS\x1b[0m
  --prompts <path>     Path to test-prompts.json (overrides plugin-local discovery)

\x1b[1mREPORT OPTIONS\x1b[0m
  --report             Generate a report file after tests complete
  --report-type <type> Report format: html, md, json        (default: html)
  --report-dir <path>  Directory to write the report to     (default: ./reports)
  --report-open        Open the HTML report in browser after completion

\x1b[1mGENERAL OPTIONS\x1b[0m
  --skip <list>      Comma-separated directory names to skip
  --ci               Non-interactive output for CI pipelines (no TUI)
  --json             Output as JSON (lint and --ci modes)
  --verbose          Show full model responses
  --dry-run          Preview test plan without running API calls
  --stop-on-fail     Stop after first failure
  --max-desc-length <n>  Max skill description length   (default: 1024)
  --disable <rules>  Comma-separated rule IDs to disable
  --config <path>    Path to conform.yml config file    (auto-discovered)
  --help, -h         Show this help message
  --version, -v      Show version

\x1b[1mEXAMPLES\x1b[0m
  conform ./my-plugin                                  \x1b[2m# All tests on a plugin\x1b[0m
  conform structural ./my-plugin                       \x1b[2m# Structural only\x1b[0m
  conform structural .claude                           \x1b[2m# Validate .claude directory\x1b[0m
  conform ./plugins/ --skip marketplace                \x1b[2m# All tests, skip a dir\x1b[0m
  conform integration ./my-plugin --auth oauth         \x1b[2m# OAuth integration\x1b[0m
  conform integration ./my-plugin --auth api           \x1b[2m# API key integration\x1b[0m
  conform structural ./my-plugin --commands            \x1b[2m# Only validate commands\x1b[0m
  conform ./my-plugin --report                         \x1b[2m# Generate HTML report\x1b[0m
  conform ./my-plugin --report --report-type md        \x1b[2m# Markdown report\x1b[0m
  conform ./my-plugin --report --report-open           \x1b[2m# Report + open in browser\x1b[0m
  conform ./my-plugin --report --report-dir ./out      \x1b[2m# Report to custom dir\x1b[0m
  conform response-log ./my-plugin                     \x1b[2m# Run test-prompts.json from plugin\x1b[0m
  conform response-log ./my-plugin --prompts t.json    \x1b[2m# Use external prompts file\x1b[0m
  conform lint ./my-plugin                             \x1b[2m# Quick lint check\x1b[0m
  conform lint ./my-plugin --json                      \x1b[2m# JSON output for CI\x1b[0m
  conform structural ./my-plugin --ci                  \x1b[2m# Non-interactive CI output\x1b[0m
  conform ./my-plugin --ci --stop-on-fail              \x1b[2m# CI mode, bail on first error\x1b[0m
`;

const MODES = new Set(["all", "structural", "integration", "response-log", "lint"]);

const DEFAULT_MODEL = "haiku";

export function parseArgs(argv: string[]): CliOptions {
    const args = argv.slice(2);

    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
        console.log(USAGE);
        process.exit(0);
    }

    if (args.includes("--version") || args.includes("-v")) {
        try {
            const pkgPath = resolve(__dirname, "../../package.json");
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
            console.log(`conform v${pkg.version ?? "unknown"}`);
        } catch {
            console.log("conform (unknown version)");
        }
        process.exit(0);
    }

    // Determine mode and target
    let mode: Mode = "all";
    let target = "";
    let argStart = 0;

    if (MODES.has(args[0])) {
        mode = args[0] as Mode;
        target = args[1] || "";
        argStart = 2;
    } else if (existsSync(args[0])) {
        target = args[0] ?? "";
        argStart = 1;
    } else {
        console.error(`Unknown mode or path not found: ${args[0]}`);
        process.exit(1);
    }

    if (!target) {
        console.error("Error: target path required");
        process.exit(1);
    }

    if (!existsSync(target)) {
        console.error(`Error: target not found: ${target}`);
        process.exit(1);
    }

    const opts: CliOptions = {
        mode,
        target,
        components: [],
        skip: "",
        model: DEFAULT_MODEL,
        maxTurns: 5,
        timeout: 60,
        verbose: false,
        dryRun: false,
        stopOnFail: false,
        auth: "oauth" as AuthMode,
        report: false,
        reportType: "html" as ReportType,
        reportDir: "./reports",
        reportOpen: false,
        promptsFile: "",
        json: false,
        ci: false,
        maxDescLength: 1024,
        disable: [],
        configFile: "",
    };

    for (let i = argStart; i < args.length; i++) {
        switch (args[i]) {
            case "--skills":
                opts.components.push("skills");
                break;
            case "--commands":
                opts.components.push("commands");
                break;
            case "--hooks":
                opts.components.push("hooks");
                break;
            case "--agents":
                opts.components.push("agents");
                break;
            case "--skip":
                opts.skip = args[++i] ?? "";
                break;
            case "--model":
                opts.model = args[++i] ?? DEFAULT_MODEL;
                break;
            case "--max-turns":
                opts.maxTurns = parseInt(args[++i], 10);
                break;
            case "--timeout":
                opts.timeout = parseInt(args[++i], 10);
                break;
            case "--verbose":
                opts.verbose = true;
                break;
            case "--dry-run":
                opts.dryRun = true;
                break;
            case "--stop-on-fail":
                opts.stopOnFail = true;
                break;
            case "--auth":
                opts.auth = args[++i] as AuthMode;
                break;
            case "--report":
                opts.report = true;
                break;
            case "--report-type":
                opts.report = true;
                opts.reportType = (args[++i] ?? "html") as ReportType;
                break;
            case "--report-dir":
                opts.report = true;
                opts.reportDir = args[++i] ?? "./reports";
                break;
            case "--report-open":
                opts.report = true;
                opts.reportOpen = true;
                break;
            case "--prompts":
                opts.promptsFile = args[++i] ?? "";
                break;
            case "--json":
                opts.json = true;
                break;
            case "--ci":
                opts.ci = true;
                break;
            case "--max-desc-length":
                opts.maxDescLength = parseInt(args[++i], 10);
                break;
            case "--disable":
                opts.disable = (args[++i] ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                break;
            case "--config":
                opts.configFile = args[++i] ?? "";
                break;
        }
    }

    if (opts.components.length === 0) {
        opts.components = ["skills", "commands", "agents", "hooks"];
    }

    return opts;
}
