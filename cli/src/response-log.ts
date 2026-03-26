import { spawn } from "node:child_process";
import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
    mkdirSync,
    writeFileSync,
    accessSync,
    constants,
} from "node:fs";
import { resolve, join, basename } from "node:path";
import type {
    CliOptions,
    ResponseLogPrompt,
    ResponseLogResult,
    ResponseLogExpect,
    ExpectationResult,
    TokenUsage,
    IntegrationVerdict,
} from "./types.js";

const MAX_PREVIEW = 500;
const MAX_STDOUT_BYTES = 1024 * 1024;

// ── Discover prompts ─────────────────────────────────────────────────

function isPluginDir(dir: string): boolean {
    try {
        for (const d of [".claude-plugin", "skills", "commands", "agents", "hooks"]) {
            const full = join(dir, d);
            if (existsSync(full) && statSync(full).isDirectory()) return true;
        }
        const claude = join(dir, ".claude");
        if (existsSync(claude) && statSync(claude).isDirectory()) {
            for (const d of ["commands", "skills", "agents", "hooks"]) {
                const full = join(claude, d);
                if (existsSync(full) && statSync(full).isDirectory()) return true;
            }
        }
    } catch {
        /* permission denied or other fs error */
    }
    return false;
}

function discoverPluginDirs(target: string): string[] {
    const abs = resolve(target);
    if (isPluginDir(abs)) return [abs];

    // Scan children
    const dirs: string[] = [];
    try {
        for (const entry of readdirSync(abs)) {
            if (entry.startsWith(".")) continue;
            try {
                const full = join(abs, entry);
                if (statSync(full).isDirectory() && isPluginDir(full)) {
                    dirs.push(full);
                }
            } catch {
                /* permission denied on child — skip it */
            }
        }
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EACCES") {
            console.error(`Warning: permission denied reading ${abs}`);
        }
    }
    return dirs;
}

function loadPromptsForPlugin(
    pluginDir: string,
    overrideFile: string,
): { plugin: string; prompts: ResponseLogPrompt[]; error?: string } {
    const plugin = basename(pluginDir);
    const file = overrideFile || join(pluginDir, "test-prompts.json");

    if (!existsSync(file)) return { plugin, prompts: [] };

    // Check readability
    try {
        accessSync(file, constants.R_OK);
    } catch {
        return { plugin, prompts: [], error: `Permission denied: ${file}` };
    }

    try {
        const raw = readFileSync(file, "utf-8");
        const data: unknown = JSON.parse(raw);
        if (!Array.isArray(data)) {
            return {
                plugin,
                prompts: [],
                error: `${file}: expected JSON array, got ${typeof data}`,
            };
        }
        return { plugin, prompts: data as ResponseLogPrompt[] };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { plugin, prompts: [], error: `Failed to parse ${file}: ${msg}` };
    }
}

// ── Evaluate expectations ────────────────────────────────────────────

function evaluateExpectations(
    response: string,
    expect: ResponseLogExpect | undefined,
): {
    expectations: Record<string, ExpectationResult>;
    allPassed: boolean;
} {
    const expectations: Record<string, ExpectationResult> = {};
    let allPassed = true;

    if (!expect) return { expectations, allPassed: true };

    // Response contains
    const lower = response.toLowerCase();
    if (expect.responseContains) {
        const missing = expect.responseContains.filter((kw) => !lower.includes(kw.toLowerCase()));
        expectations.responseContains = {
            expected: expect.responseContains,
            missing,
            pass: missing.length === 0,
        };
        if (missing.length > 0) allPassed = false;
    }

    // Response not contains
    if (expect.responseNotContains) {
        const found = expect.responseNotContains.filter((kw) => lower.includes(kw.toLowerCase()));
        expectations.responseNotContains = {
            expected: expect.responseNotContains,
            found,
            pass: found.length === 0,
        };
        if (found.length > 0) allPassed = false;
    }

    return { expectations, allPassed };
}

// ── Diagnose error from stderr ───────────────────────────────────────

function diagnoseError(code: number | null, stderr: string): string {
    const lower = stderr.toLowerCase();

    if (
        lower.includes("not authenticated") ||
        lower.includes("login") ||
        lower.includes("unauthorized")
    ) {
        return `Authentication failed (exit ${code}). Run: claude login`;
    }
    if (lower.includes("invalid api key") || lower.includes("invalid x-api-key")) {
        return `Invalid API key (exit ${code}). Check ANTHROPIC_API_KEY`;
    }
    if (lower.includes("rate limit") || lower.includes("429")) {
        return `Rate limited (exit ${code}). Wait and retry`;
    }
    if (lower.includes("timeout") || lower.includes("timed out")) {
        return `Request timed out (exit ${code})`;
    }
    if (
        lower.includes("enotfound") ||
        lower.includes("network") ||
        lower.includes("econnrefused")
    ) {
        return `Network error (exit ${code}). Check internet connection`;
    }

    // Generic — include first line of stderr for context
    const firstLine =
        stderr
            .split("\n")
            .find((l) => l.trim())
            ?.trim() || "";
    const detail = firstLine.length > 120 ? firstLine.slice(0, 117) + "..." : firstLine;
    return detail ? `Exit ${code}: ${detail}` : `Process exited with code ${code}`;
}

// ── Run a single prompt ──────────────────────────────────────────────

function runSinglePrompt(
    pluginDir: string,
    prompt: ResponseLogPrompt,
    opts: CliOptions,
): Promise<ResponseLogResult> {
    return new Promise((resolvePromise) => {
        const plugin = basename(pluginDir);
        const startTime = Date.now();
        let timedOut = false;

        // Uses spawn (not exec) — arguments are passed as an array, no shell injection risk
        const args = [
            "-p",
            prompt.prompt,
            "--plugin-dir",
            pluginDir,
            "--model",
            opts.model,
            "--max-turns",
            String(opts.maxTurns),
            "--output-format",
            "text",
        ];

        // Clear CLAUDECODE so nested claude invocations work from within a Claude Code session.
        // When using OAuth, clear ANTHROPIC_API_KEY so claude uses the OAuth session.
        const spawnEnv: Record<string, string | undefined> = { ...process.env, CLAUDECODE: "" };
        if (opts.auth === "oauth") {
            delete spawnEnv.ANTHROPIC_API_KEY;
        }

        const proc = spawn("claude", args, {
            env: spawnEnv,
            cwd: pluginDir,
            stdio: ["ignore", "pipe", "pipe"],
        });

        // Per-prompt timeout
        const timeoutMs = opts.timeout * 1000;
        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill("SIGTERM");
            setTimeout(() => {
                try {
                    proc.kill("SIGKILL");
                } catch {
                    /* already dead */
                }
            }, 5000);
        }, timeoutMs);

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
            if (stdout.length > MAX_STDOUT_BYTES) {
                stdout = stdout.slice(-MAX_STDOUT_BYTES);
            }
        });

        proc.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
            // Cap stderr too
            if (stderr.length > MAX_STDOUT_BYTES) {
                stderr = stderr.slice(-MAX_STDOUT_BYTES);
            }
        });

        const buildResult = (
            verdict: IntegrationVerdict,
            verdictDetail: string,
        ): ResponseLogResult => ({
            id: prompt.id,
            plugin,
            component: prompt.component,
            name: prompt.name,
            prompt: prompt.prompt,
            verdict,
            verdictDetail,
            response: stdout,
            responsePreview: stdout.slice(0, MAX_PREVIEW),
            expectations: {},
            costUsd: 0,
            tokens: null,
            durationMs: Date.now() - startTime,
        });

        proc.on("close", (code) => {
            clearTimeout(timer);
            const durationMs = Date.now() - startTime;

            // Handle timeout
            if (timedOut) {
                resolvePromise(buildResult("error", `Timed out after ${opts.timeout}s`));
                return;
            }

            // Parse cost from output if present
            const costMatch = /\$([0-9.]+)/.exec(stdout + stderr);
            const costUsd = costMatch ? parseFloat(costMatch[1]) : 0;

            // Parse tokens if present
            const tokenMatch = /tokens:(\d+)\/(\d+)\/(\d+)\/(\d+)/.exec(stdout + stderr);
            const tokens: TokenUsage | null = tokenMatch
                ? {
                      inputTokens: parseInt(tokenMatch[1], 10),
                      outputTokens: parseInt(tokenMatch[2], 10),
                      cacheReadInputTokens: parseInt(tokenMatch[3], 10),
                      cacheCreationInputTokens: parseInt(tokenMatch[4], 10),
                  }
                : null;

            const { expectations, allPassed } = evaluateExpectations(stdout, prompt.expect);

            let verdict: IntegrationVerdict;
            let verdictDetail: string;

            if (code !== 0 && code !== null) {
                verdict = "error";
                verdictDetail = diagnoseError(code, stderr);
            } else if (!prompt.expect) {
                verdict = stdout.trim().length > 0 ? "pass" : "warn";
                verdictDetail =
                    stdout.trim().length > 0
                        ? "Response received (no expectations defined)"
                        : "Empty response (no expectations defined)";
            } else if (allPassed) {
                verdict = "pass";
                verdictDetail = "All expectations met";
            } else {
                verdict = "fail";
                const failedKeys = Object.entries(expectations)
                    .filter(([, v]) => !v.pass)
                    .map(([k]) => k);
                verdictDetail = `Failed: ${failedKeys.join(", ")}`;
            }

            resolvePromise({
                id: prompt.id,
                plugin,
                component: prompt.component,
                name: prompt.name,
                prompt: prompt.prompt,
                verdict,
                verdictDetail,
                response: stdout,
                responsePreview: stdout.slice(0, MAX_PREVIEW),
                expectations,
                costUsd,
                tokens,
                durationMs,
            });
        });

        proc.on("error", (err) => {
            clearTimeout(timer);
            const code = (err as NodeJS.ErrnoException).code;
            let detail: string;
            if (code === "ENOENT") {
                detail =
                    "claude CLI not found on PATH. Install: https://docs.anthropic.com/en/docs/claude-code/overview";
            } else if (code === "EACCES") {
                detail = "claude CLI found but not executable. Check file permissions";
            } else {
                detail = `Failed to start claude: ${err.message}`;
            }
            resolvePromise(buildResult("error", detail));
        });
    });
}

// ── Main runner ──────────────────────────────────────────────────────

export async function runResponseLog(
    opts: CliOptions,
    onResult: (r: ResponseLogResult) => void,
    onStart: (id: string, prompt: string) => void,
    onTotal?: (total: number) => void,
    onWarning?: (msg: string) => void,
): Promise<ResponseLogResult[]> {
    const pluginDirs = discoverPluginDirs(opts.target);
    const allResults: ResponseLogResult[] = [];

    if (pluginDirs.length === 0) {
        onWarning?.(`No plugin directories found in ${resolve(opts.target)}`);
    }

    // Collect all prompts across plugins
    const work: { pluginDir: string; prompt: ResponseLogPrompt }[] = [];
    for (const dir of pluginDirs) {
        const { prompts, error } = loadPromptsForPlugin(dir, opts.promptsFile);
        if (error) {
            onWarning?.(error);
        }
        for (const p of prompts) {
            work.push({ pluginDir: dir, prompt: p });
        }
    }

    if (work.length === 0) {
        if (pluginDirs.length > 0) {
            onWarning?.(
                "No test-prompts.json found in any plugin directory. Use --prompts <file> or create test-prompts.json in your plugin.",
            );
        }
        return allResults;
    }
    if (onTotal) onTotal(work.length);

    if (opts.dryRun) {
        for (const { pluginDir, prompt: p } of work) {
            const result: ResponseLogResult = {
                id: p.id,
                plugin: basename(pluginDir),
                component: p.component,
                name: p.name,
                prompt: p.prompt,
                verdict: "skip",
                verdictDetail: "Dry run",
                response: "",
                responsePreview: "",
                expectations: {},
                costUsd: 0,
                tokens: null,
                durationMs: 0,
            };
            onResult(result);
            allResults.push(result);
        }
        return allResults;
    }

    for (const { pluginDir, prompt: p } of work) {
        onStart(p.id, p.prompt);
        const result = await runSinglePrompt(pluginDir, p, opts);
        onResult(result);
        allResults.push(result);

        if (opts.stopOnFail && (result.verdict === "fail" || result.verdict === "error")) {
            break;
        }
    }

    return allResults;
}

// ── Write response log JSON ──────────────────────────────────────────

export function writeResponseLog(opts: CliOptions, results: ResponseLogResult[]): string {
    const dir = resolve(process.cwd(), opts.reportDir);

    try {
        mkdirSync(dir, { recursive: true });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Cannot create report directory ${dir}: ${msg}`, { cause: err });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const targetName = basename(resolve(process.cwd(), opts.target));
    const filename = `response-log-${targetName}-${ts}.json`;
    const filepath = resolve(dir, filename);

    try {
        writeFileSync(filepath, JSON.stringify(results, null, 2), "utf-8");
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Cannot write report to ${filepath}: ${msg}`, { cause: err });
    }

    return filepath;
}
