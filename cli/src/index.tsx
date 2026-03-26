#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { parseArgs } from "./parse-args.js";
import { runPreflight, printPreflight } from "./preflight.js";
import { App } from "./App.js";
import { hideCursor, cleanup } from "./screen.js";
import { lint, loadConfig } from "./lint/index.js";
import { discoverPlugins, runStructural, runIntegration } from "./runners.js";
import { runResponseLog } from "./response-log.js";
import { writeReport } from "./report.js";
import { A } from "./theme.js";
import type { LintOptions } from "./lint/types.js";
import { modeFlags } from "./types.js";
import type {
    CliOptions,
    StructuralResult,
    IntegrationResult,
    ResponseLogResult,
} from "./types.js";

const opts = parseArgs(process.argv);

/** Print a pass/fail/warn summary line for CI output */
function printCiSummary(passed: number, failed: number, warned: number, bailed: boolean) {
    const parts: string[] = [`${A.green}${passed} passed${A.reset}`];
    if (failed > 0) parts.push(`${A.red}${failed} failed${A.reset}`);
    if (warned > 0) parts.push(`${A.yellow}${warned} warnings${A.reset}`);
    console.log(`  ${parts.join("  ")}`);
    if (bailed) console.log(`\n${A.red}${A.bold}Stopped on first failure${A.reset}`);
    console.log();
}

// ── Lint mode: run linter directly, no TUI ──────────────────────────
if (opts.mode === "lint") {
    // Load config file (CLI flags take priority)
    const config = loadConfig(opts.configFile || undefined, [opts.target, process.cwd()]);

    const lintOpts: LintOptions = {
        verbose: opts.verbose,
        maxDescLength:
            opts.maxDescLength !== 1024 ? opts.maxDescLength : (config.maxDescLength ?? 1024),
        disable: opts.disable.length > 0 ? opts.disable : (config.rules?.disable ?? []),
    };
    if (opts.components.length < 4) {
        lintOpts.components = opts.components as LintOptions["components"];
    }

    const summary = lint(opts.target, lintOpts);

    if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
    } else {
        console.log(`\n${A.bold}conform lint${A.reset} ${A.dim}${summary.target}${A.reset}\n`);

        // Show what was scanned
        const scanParts: string[] = [];
        if (summary.scanned.manifest) scanParts.push("manifest");
        if (summary.scanned.skills > 0)
            scanParts.push(
                `${summary.scanned.skills} skill${summary.scanned.skills > 1 ? "s" : ""}`,
            );
        if (summary.scanned.commands > 0)
            scanParts.push(
                `${summary.scanned.commands} command${summary.scanned.commands > 1 ? "s" : ""}`,
            );
        if (summary.scanned.agents > 0)
            scanParts.push(
                `${summary.scanned.agents} agent${summary.scanned.agents > 1 ? "s" : ""}`,
            );
        if (summary.scanned.hooks > 0) scanParts.push("hooks");
        if (scanParts.length > 0) {
            console.log(`  ${A.dim}scanned: ${scanParts.join(", ")}${A.reset}\n`);
        }

        const SEVERITY_STYLE: Record<string, { color: string; icon: string }> = {
            error: { color: A.red, icon: "✘" },
            warning: { color: A.yellow, icon: "!" },
            info: { color: A.dim, icon: "·" },
        };

        for (const r of summary.results) {
            const style = SEVERITY_STYLE[r.severity] ?? SEVERITY_STYLE.info;
            const color = style.color;
            const icon = style.icon;
            console.log(`  ${color}${icon}${A.reset} ${r.message}`);
            if (r.detail) {
                console.log(`    ${A.dim}↳ ${r.detail}${A.reset}`);
            }
        }

        console.log();

        if (summary.errors === 0 && summary.warnings === 0) {
            console.log(`  ${A.green}${A.bold}✔ All clear${A.reset}\n`);
        } else {
            const parts: string[] = [];
            if (summary.errors > 0) parts.push(`${A.red}${summary.errors} errors${A.reset}`);
            if (summary.warnings > 0)
                parts.push(`${A.yellow}${summary.warnings} warnings${A.reset}`);
            console.log(`  ${parts.join("  ")}\n`);
        }
    }

    process.exit(summary.passed ? 0 : 1);
}

// ── CI mode: non-interactive output, no TUI ─────────────────────────
if (opts.ci) {
    printPreflight(runPreflight(opts));

    const { showStructural, showIntegration, showResponseLog } = modeFlags(opts.mode);

    let hasFailures = false;
    let bailed = false;
    const abortCtrl = new AbortController();

    const structResults: StructuralResult[] = [];
    const intResults: IntegrationResult[] = [];
    const rlResults: ResponseLogResult[] = [];

    const COMPONENT_TAG: Record<string, string> = {
        manifest: `${A.dim}[manifest]${A.reset}`,
        skill: `${A.cyan}[skill]${A.reset}`,
        command: `${A.magenta}[command]${A.reset}`,
        agent: `${A.blue}[agent]${A.reset}`,
        hook: `${A.yellow}[hook]${A.reset}`,
        unknown: `${A.dim}[?]${A.reset}`,
    };

    function printVerdict(
        icon: string,
        color: string,
        label: string,
        detail?: string,
        component?: string,
    ) {
        const tag = component ? `${COMPONENT_TAG[component] || ""} ` : "";
        console.log(`${color}${icon}${A.reset} ${tag}${label}`);
        if (detail) console.log(`  ${A.dim}↳ ${detail}${A.reset}`);
    }

    type PhaseState = {
        passed: number;
        failed: number;
        warned: number;
        bailed: boolean;
        hasFailures: boolean;
    };

    async function runCiStructural(
        opts: CliOptions,
        structResults: StructuralResult[],
        abortCtrl: AbortController,
        COMPONENT_TAG: Record<string, string>,
        printVerdictFn: typeof printVerdict,
        state: PhaseState,
    ): Promise<PhaseState> {
        console.log(`${A.bold}▸ Structural Tests${A.reset}`);
        let passed = 0,
            failed = 0,
            warned = 0;
        const componentCounts: Record<string, { passed: number; failed: number; warned: number }> =
            {};

        await runStructural(
            opts,
            (r) => {
                structResults.push(r);
                const cc = (componentCounts[r.component] ??= {
                    passed: 0,
                    failed: 0,
                    warned: 0,
                });
                if (r.verdict === "fail") {
                    failed++;
                    cc.failed++;
                    state.hasFailures = true;
                    printVerdictFn("✘", A.red, r.label, r.detail, r.component);
                    if (opts.stopOnFail) {
                        state.bailed = true;
                        abortCtrl.abort();
                    }
                } else if (r.verdict === "warn") {
                    warned++;
                    cc.warned++;
                    printVerdictFn("!", A.yellow, r.label, r.detail, r.component);
                } else if (r.verdict === "pass") {
                    passed++;
                    cc.passed++;
                    if (opts.verbose) printVerdictFn("✔", A.green, r.label, undefined, r.component);
                }
            },
            (section) => {
                if (opts.verbose) console.log(`${A.dim}  ${section}${A.reset}`);
            },
            abortCtrl.signal,
        );

        // Per-component summary
        const order = ["manifest", "skill", "command", "agent", "hook"];
        const compParts: string[] = [];
        for (const c of order) {
            const cc = componentCounts[c];
            if (!cc) continue;
            const total = cc.passed + cc.failed + cc.warned;
            if (cc.failed > 0) {
                compParts.push(`${COMPONENT_TAG[c]} ${cc.passed}/${total}`);
            } else {
                compParts.push(`${COMPONENT_TAG[c]} ${A.green}${total}${A.reset}`);
            }
        }
        if (compParts.length > 0) console.log(`  ${compParts.join("  ")}`);

        printCiSummary(passed, failed, warned, state.bailed);
        return {
            ...state,
            passed,
            failed,
            warned,
            bailed: state.bailed,
            hasFailures: state.hasFailures,
        };
    }

    async function runCiIntegration(
        opts: CliOptions,
        intResults: IntegrationResult[],
        printVerdictFn: typeof printVerdict,
        state: PhaseState,
    ): Promise<PhaseState> {
        console.log(`${A.bold}▸ Integration Tests${A.reset}`);
        let passed = 0,
            failed = 0,
            warned = 0;

        await runIntegration(
            opts,
            (r) => {
                intResults.push(r);
                if (r.verdict === "fail" || r.verdict === "error") {
                    failed++;
                    state.hasFailures = true;
                    printVerdictFn("✘", A.red, `${r.testId} "${r.trigger}"`, r.detail);
                    if (opts.stopOnFail) state.bailed = true;
                } else if (r.verdict === "warn") {
                    warned++;
                    printVerdictFn("!", A.yellow, `${r.testId} "${r.trigger}"`, r.detail);
                } else if (r.verdict === "pass") {
                    passed++;
                    if (opts.verbose) printVerdictFn("✔", A.green, `${r.testId} "${r.trigger}"`);
                } else if (r.verdict === "skip") {
                    if (opts.verbose) printVerdictFn("·", A.dim, `${r.testId} (skip)`);
                }
            },
            (testId, trigger) => {
                if (opts.verbose)
                    process.stdout.write(`${A.dim}  running: ${testId} "${trigger}"${A.reset}\r`);
            },
            () => {},
        );

        printCiSummary(passed, failed, warned, state.bailed);
        return {
            ...state,
            passed,
            failed,
            warned,
            bailed: state.bailed,
            hasFailures: state.hasFailures,
        };
    }

    async function runCiResponseLog(
        opts: CliOptions,
        rlResults: ResponseLogResult[],
        printVerdictFn: typeof printVerdict,
        state: PhaseState,
    ): Promise<PhaseState> {
        console.log(`${A.bold}▸ Response Log${A.reset}`);
        let passed = 0,
            failed = 0,
            warned = 0;

        await runResponseLog(
            opts,
            (r) => {
                rlResults.push(r);
                if (r.verdict === "fail" || r.verdict === "error") {
                    failed++;
                    state.hasFailures = true;
                    printVerdictFn(
                        "✘",
                        A.red,
                        `${r.plugin}/${r.name} "${r.prompt}"`,
                        r.verdictDetail,
                    );
                    if (opts.stopOnFail) state.bailed = true;
                } else if (r.verdict === "warn") {
                    warned++;
                    printVerdictFn(
                        "!",
                        A.yellow,
                        `${r.plugin}/${r.name} "${r.prompt}"`,
                        r.verdictDetail,
                    );
                } else if (r.verdict === "pass") {
                    passed++;
                    if (opts.verbose)
                        printVerdictFn("✔", A.green, `${r.plugin}/${r.name}`, r.verdictDetail);
                } else if (r.verdict === "skip") {
                    if (opts.verbose) printVerdictFn("·", A.dim, `${r.plugin}/${r.name} (skip)`);
                }
            },
            (id, prompt) => {
                if (opts.verbose)
                    process.stdout.write(
                        `${A.dim}  running: ${id} "${prompt.slice(0, 50)}"${A.reset}\r`,
                    );
            },
            () => {},
            (warning) => {
                console.log(`${A.yellow}! ${warning}${A.reset}`);
            },
        );

        printCiSummary(passed, failed, warned, state.bailed);
        return {
            ...state,
            passed,
            failed,
            warned,
            bailed: state.bailed,
            hasFailures: state.hasFailures,
        };
    }

    function printCiDiscovery() {
        const discovery = discoverPlugins(opts);
        if (discovery.plugins.length === 0) return;

        console.log(`${A.bold}▸ Discovery${A.reset}`);
        const TYPE_LABELS: Record<string, string> = {
            plugin: "plugin",
            project: ".claude project",
            standalone: "standalone",
        };
        for (const p of discovery.plugins) {
            const parts: string[] = [];
            if (p.skills > 0) parts.push(`${p.skills} skill${p.skills > 1 ? "s" : ""}`);
            if (p.commands > 0) parts.push(`${p.commands} cmd${p.commands > 1 ? "s" : ""}`);
            if (p.agents > 0) parts.push(`${p.agents} agent${p.agents > 1 ? "s" : ""}`);
            if (p.hooks > 0) parts.push(`${p.hooks} hook${p.hooks > 1 ? "s" : ""}`);
            const typeLabel = TYPE_LABELS[p.type] || p.type;
            console.log(
                `  ${A.cyan}◆${A.reset} ${p.name} ${A.dim}(${typeLabel})${A.reset} — ${parts.join(", ")}`,
            );
        }
        console.log(
            `  ${A.dim}${discovery.plugins.length} plugin${discovery.plugins.length > 1 ? "s" : ""} loaded${A.reset}\n`,
        );
    }

    function printCiOutput(
        state: PhaseState,
        structResults: StructuralResult[],
        intResults: IntegrationResult[],
        rlResults: ResponseLogResult[],
    ) {
        if (opts.json) {
            const output = {
                mode: opts.mode,
                target: opts.target,
                passed: !state.hasFailures,
                structural: structResults,
                integration: intResults,
                responseLog: rlResults,
            };
            console.log(JSON.stringify(output, null, 2));
        }

        if (opts.report) {
            try {
                const reportPath = writeReport(opts, structResults, intResults, rlResults);
                console.log(`${A.dim}Report: ${reportPath}${A.reset}`);
            } catch (err) {
                console.error("Failed to write report:", err);
            }
        }
    }

    async function run() {
        console.log(
            `\n${A.bold}${A.cyan}conform${A.reset} ${A.dim}${opts.mode} ${opts.target}${A.reset}\n`,
        );

        printCiDiscovery();

        const state: PhaseState = { passed: 0, failed: 0, warned: 0, bailed, hasFailures };

        if (showStructural && !state.bailed) {
            await runCiStructural(
                opts,
                structResults,
                abortCtrl,
                COMPONENT_TAG,
                printVerdict,
                state,
            );
        }
        if (showIntegration && !state.bailed) {
            await runCiIntegration(opts, intResults, printVerdict, state);
        }
        if (showResponseLog && !state.bailed) {
            await runCiResponseLog(opts, rlResults, printVerdict, state);
        }

        bailed = state.bailed;
        hasFailures = state.hasFailures;

        printCiOutput(state, structResults, intResults, rlResults);
    }

    run()
        .then(() => process.exit(hasFailures ? 1 : 0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
} else {
    // ── All other modes: pre-flight + TUI ───────────────────────────────
    printPreflight(runPreflight(opts));

    hideCursor();

    process.on("exit", cleanup);
    process.on("SIGINT", () => {
        cleanup();
        process.exit(130);
    });
    process.on("SIGTERM", () => {
        cleanup();
        process.exit(143);
    });

    const instance = render(<App opts={opts} />);

    void instance.waitUntilExit().then(() => {
        cleanup();
        process.exit(process.exitCode ?? 0);
    });
}
