/**
 * Pre-flight checks run before any tests execute.
 * Validates environment, auth, and target to surface clear errors early.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, accessSync, constants } from "node:fs";
import { resolve, join } from "node:path";
import { A } from "./theme.js";
import type { CliOptions } from "./types.js";

export interface PreflightResult {
    ok: boolean;
    errors: string[];
    warnings: string[];
}

/** Check if a binary exists on PATH */
function commandExists(cmd: string): boolean {
    try {
        execFileSync("which", [cmd], { stdio: "pipe" });
        return true;
    } catch {
        return false;
    }
}

/** Check if claude CLI is authenticated (has active session) */
function claudeIsAuthenticated(): { ok: boolean; detail: string } {
    try {
        const result = execFileSync("claude", ["--version"], {
            stdio: "pipe",
            timeout: 5000,
        });
        // If --version works, CLI is installed. Check auth by trying a minimal call.
        // We use `claude -p "test" --max-turns 0` which should fail gracefully if not authed.
        return { ok: true, detail: result.toString().trim() };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ENOENT")) {
            return { ok: false, detail: "claude CLI not found on PATH" };
        }
        return { ok: false, detail: msg };
    }
}

/** Validate ANTHROPIC_API_KEY format (basic check) */
function validateApiKeyFormat(key: string): { ok: boolean; detail: string } {
    if (!key) {
        return { ok: false, detail: "ANTHROPIC_API_KEY is not set" };
    }
    if (!key.startsWith("sk-ant-")) {
        return { ok: false, detail: "ANTHROPIC_API_KEY should start with 'sk-ant-'" };
    }
    if (key.length < 20) {
        return { ok: false, detail: "ANTHROPIC_API_KEY appears too short" };
    }
    return { ok: true, detail: "" };
}

/** Check if a directory is readable */
function isReadable(path: string): boolean {
    try {
        accessSync(path, constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

/** Check if any plugin directory contains test-prompts.json */
function findTestPrompts(target: string): boolean {
    // Check target itself
    if (existsSync(join(target, "test-prompts.json"))) return true;

    // Check children
    try {
        for (const entry of readdirSync(target)) {
            if (entry.startsWith(".")) continue;
            const full = join(target, entry);
            if (!statSync(full).isDirectory()) continue;
            if (existsSync(join(full, "test-prompts.json"))) return true;
            // Check .claude subdir
            const claude = join(full, ".claude");
            if (existsSync(join(claude, "test-prompts.json"))) return true;
        }
    } catch {
        /* unreadable */
    }
    return false;
}

/** Check if target has any plugin directories */
function hasPlugins(target: string): { found: boolean; count: number } {
    const abs = resolve(target);
    const pluginMarkers = [".claude-plugin", "skills", "commands", "agents", "hooks"];

    // Check if target itself is a plugin
    for (const d of pluginMarkers) {
        if (existsSync(join(abs, d))) return { found: true, count: 1 };
    }
    // Check .claude/ subdir
    const claude = join(abs, ".claude");
    if (existsSync(claude) && statSync(claude).isDirectory()) {
        for (const d of ["commands", "skills", "agents", "hooks"]) {
            if (existsSync(join(claude, d))) return { found: true, count: 1 };
        }
    }

    // Check children
    let count = 0;
    try {
        for (const entry of readdirSync(abs)) {
            if (entry.startsWith(".")) continue;
            const full = join(abs, entry);
            if (!statSync(full).isDirectory()) continue;
            for (const d of pluginMarkers) {
                if (existsSync(join(full, d))) {
                    count++;
                    break;
                }
            }
        }
    } catch {
        /* unreadable */
    }

    return { found: count > 0, count };
}

/**
 * Run all pre-flight checks for the given options.
 * Returns errors (blocking) and warnings (advisory).
 */
function validateTarget(opts: CliOptions): { errors: string[] } {
    const errors: string[] = [];
    const targetAbs = resolve(opts.target);

    // 1. Target exists and is readable
    if (!existsSync(targetAbs)) {
        errors.push(`Target not found: ${targetAbs}`);
        return { errors };
    }
    if (!isReadable(targetAbs)) {
        errors.push(`Permission denied: cannot read ${targetAbs}`);
        return { errors };
    }

    // 2. Target has plugins — error if nothing to test
    if (!opts.dryRun) {
        const { found } = hasPlugins(targetAbs);
        if (!found) {
            errors.push(
                `No plugin directories found in ${targetAbs}\n` +
                    "  Expected: .claude-plugin/, skills/, commands/, agents/, or hooks/\n" +
                    "  Or a .claude/ directory containing these components",
            );
        }
    }

    return { errors };
}

function validateAuth(opts: CliOptions, errors: string[], warnings: string[]): void {
    const runsIntegration = opts.mode === "all" || opts.mode === "integration";
    const needsClaude = opts.mode === "response-log" || (runsIntegration && opts.auth === "oauth");
    const needsApiKey = runsIntegration && opts.auth === "api";

    // 3. claude CLI check (for oauth, response-log modes)
    if (needsClaude && !opts.dryRun) {
        if (!commandExists("claude")) {
            errors.push(
                "claude CLI not found on PATH\n" +
                    "  Install: https://docs.anthropic.com/en/docs/claude-code/overview\n" +
                    "  Or use API key mode instead: --auth api",
            );
        } else {
            const auth = claudeIsAuthenticated();
            if (!auth.ok) {
                warnings.push(
                    `claude CLI may not be authenticated: ${auth.detail}\n` + "  Run: claude login",
                );
            }
        }
    }

    // 4. API key check (for --auth api mode)
    if (needsApiKey && !opts.dryRun) {
        const key = process.env.ANTHROPIC_API_KEY || "";
        const keyCheck = validateApiKeyFormat(key);
        if (!keyCheck.ok) {
            errors.push(
                `${keyCheck.detail}\n` +
                    "  Set: export ANTHROPIC_API_KEY=sk-ant-...\n" +
                    "  Or use OAuth mode instead: --auth oauth",
            );
        }
    }
}

export function runPreflight(opts: CliOptions): PreflightResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1-2. Validate target exists and has plugins
    const targetCheck = validateTarget(opts);
    if (targetCheck.errors.length > 0) {
        errors.push(...targetCheck.errors);
        return { ok: false, errors, warnings };
    }

    // 3-4. Validate auth (claude CLI / API key)
    validateAuth(opts, errors, warnings);

    // 5. Prompts file check (for response-log mode)
    if (opts.mode === "response-log") {
        if (opts.promptsFile) {
            if (!existsSync(opts.promptsFile)) {
                errors.push(`Prompts file not found: ${opts.promptsFile}`);
            } else if (!isReadable(opts.promptsFile)) {
                errors.push(`Permission denied: cannot read ${opts.promptsFile}`);
            }
        } else {
            // Check that at least one plugin has a test-prompts.json
            const hasPrompts = findTestPrompts(resolve(opts.target));
            if (!hasPrompts) {
                errors.push(
                    `No test-prompts.json found for response-log mode\n` +
                        "  Create test-prompts.json in your plugin directory, or use --prompts <file>",
                );
            }
        }
    }

    // 6. Report directory check (if --report)
    if (opts.report) {
        const reportDir = resolve(process.cwd(), opts.reportDir);
        const parentDir = resolve(reportDir, "..");
        if (existsSync(parentDir) && !isReadable(parentDir)) {
            warnings.push(`Report directory parent may not be writable: ${parentDir}`);
        }
    }

    return { ok: errors.length === 0, errors, warnings };
}

/**
 * Print preflight results to stderr and exit if fatal.
 * Returns true if checks passed, never returns if they fail.
 */
export function printPreflight(result: PreflightResult): void {
    if (result.warnings.length > 0) {
        for (const w of result.warnings) {
            process.stderr.write(`${A.yellow}${A.bold}!${A.reset} ${A.yellow}${w}${A.reset}\n`);
        }
        process.stderr.write("\n");
    }
    if (!result.ok) {
        process.stderr.write(`${A.red}${A.bold}Pre-flight checks failed:${A.reset}\n\n`);
        for (const e of result.errors) {
            process.stderr.write(`${A.red}  ✘ ${e}${A.reset}\n\n`);
        }
        process.exit(1);
    }
}
