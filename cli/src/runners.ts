import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import type {
    CliOptions,
    StructuralResult,
    StructuralVerdict,
    IntegrationResult,
    IntegrationVerdict,
    ComponentType,
    DiscoveryResult,
    DiscoveryPlugin,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = resolve(__dirname, "../..");

// Safety limit: discard buffer if it exceeds 1MB without a newline
const MAX_BUFFER_BYTES = 1024 * 1024;

// TAP line pattern: ok N - label or not ok N - label # comment
const TAP_PREFIX_RE = /^(ok|not ok) (\d+) - /;

function parseTapLine(line: string): StructuralResult | null {
    const m = TAP_PREFIX_RE.exec(line);
    if (!m) return null;

    const isOk = m[1] === "ok";
    const id = parseInt(m[2], 10);
    const rest = line.slice(m[0].length);

    // Split on " # " to separate label from comment
    const hashIdx = rest.indexOf(" # ");
    const label = hashIdx >= 0 ? rest.slice(0, hashIdx).trimEnd() : rest.trimEnd();
    const comment = hashIdx >= 0 ? rest.slice(hashIdx + 3) : "";

    let verdict: StructuralVerdict;
    if (comment.startsWith("SKIP")) verdict = "skip";
    else if (comment.startsWith("WARN")) verdict = "warn";
    else if (isOk) verdict = "pass";
    else verdict = "fail";

    const detailMatch = /^(?:WARN|SKIP|FAIL):\s*(.*)/.exec(comment);
    const detail = detailMatch ? detailMatch[1] : comment;

    return { id, verdict, label, detail, component: "unknown" as ComponentType };
}

// Per-process timeout: 5 minutes for structural, configurable for integration
const STRUCTURAL_TIMEOUT_MS = 5 * 60 * 1000;

function withTimeout(
    proc: ReturnType<typeof spawn>,
    timeoutMs: number,
    label: string,
): NodeJS.Timeout {
    return setTimeout(() => {
        proc.kill("SIGTERM");
        // Give it 5s to die gracefully, then force kill
        setTimeout(() => {
            try {
                proc.kill("SIGKILL");
            } catch {
                /* already dead */
            }
        }, 5000);
        console.error(`Timeout: ${label} exceeded ${Math.round(timeoutMs / 1000)}s limit`);
    }, timeoutMs);
}

// ── Plugin discovery ────────────────────────────────────────────────

/**
 * Run generate-cases.py to discover plugins and count components.
 * Fast, synchronous, no API calls — safe to call before tests.
 */
/**
 * Check if a directory is itself a plugin (has component dirs or .claude-plugin/).
 */
function isPluginDir(dir: string): boolean {
    for (const d of [".claude-plugin", "skills", "commands", "agents", "hooks"]) {
        if (existsSync(resolve(dir, d))) return true;
    }
    // .claude/ with components inside
    const claudeDir = resolve(dir, ".claude");
    if (existsSync(claudeDir)) {
        for (const d of ["commands", "skills", "agents", "hooks"]) {
            if (existsSync(resolve(claudeDir, d))) return true;
        }
    }
    return false;
}

/**
 * Resolve target path for generate-cases.py.
 *
 * When the target IS a .claude directory (e.g. /path/project/.claude),
 * the plugin is the parent directory (project), so we need to go up
 * one more level for plugins_dir and use the parent name as the filter.
 *
 * Returns { pluginsDir, targetName } where targetName is empty if scanning all.
 */
function resolveForCaseGen(targetAbs: string): { pluginsDir: string; targetName: string } {
    const basename = targetAbs.split("/").pop() || "";
    const isSingle = isPluginDir(targetAbs);

    if (basename === ".claude" && isSingle) {
        // Target is a .claude project dir — the "plugin" is the parent directory
        const projectDir = resolve(targetAbs, "..");
        const projectName = projectDir.split("/").pop() || "";
        const pluginsDir = resolve(projectDir, "..");
        return { pluginsDir, targetName: projectName };
    }

    if (isSingle) {
        return { pluginsDir: resolve(targetAbs, ".."), targetName: basename };
    }

    return { pluginsDir: targetAbs, targetName: "" };
}

export function discoverPlugins(opts: CliOptions): DiscoveryResult {
    const targetAbs = resolve(process.cwd(), opts.target);
    const casesFile = resolve(SUITE_DIR, "integration/.discovery-cases.json");
    const genScript = resolve(SUITE_DIR, "integration/generate-cases.py");

    const typesArg =
        opts.components.length > 0 ? opts.components.join(",") : "skills,commands,hooks,agents";

    // generate-cases.py expects the parent directory containing plugins.
    // If target is a single plugin dir, pass its parent and filter results.
    // Special case: .claude dirs need to go up two levels (grandparent).
    const { pluginsDir, targetName } = resolveForCaseGen(targetAbs);

    try {
        execFileSync(
            "python3",
            [
                genScript,
                casesFile,
                "--plugins-dir",
                pluginsDir,
                "--skip",
                opts.skip || "",
                "--types",
                typesArg,
            ],
            {
                cwd: SUITE_DIR,
                stdio: ["ignore", "pipe", "pipe"],
                timeout: 10000,
            },
        );
    } catch {
        return { plugins: [], totalCases: 0 };
    }

    if (!existsSync(casesFile)) {
        return { plugins: [], totalCases: 0 };
    }

    let cases: Array<{ plugin: string; plugin_type: string; type: string }>;
    try {
        cases = JSON.parse(readFileSync(casesFile, "utf-8")) as typeof cases;
    } catch {
        return { plugins: [], totalCases: 0 };
    }

    // Filter to target plugin when a single plugin dir is targeted
    if (targetName) {
        cases = cases.filter((c) => c.plugin === targetName);
    }

    // Aggregate by plugin
    const pluginMap = new Map<string, DiscoveryPlugin>();
    for (const c of cases) {
        let p = pluginMap.get(c.plugin);
        if (!p) {
            p = {
                name: c.plugin,
                type: c.plugin_type,
                skills: 0,
                commands: 0,
                agents: 0,
                hooks: 0,
            };
            pluginMap.set(c.plugin, p);
        }
        if (c.type === "skill") p.skills++;
        else if (c.type === "command") p.commands++;
        else if (c.type === "agent") p.agents++;
        else if (c.type === "hook") p.hooks++;
    }

    return {
        plugins: Array.from(pluginMap.values()),
        totalCases: cases.length,
    };
}

// ── Structural tests ────────────────────────────────────────────────

export function runStructural(
    opts: CliOptions,
    onResult: (r: StructuralResult) => void,
    onSection: (name: string) => void,
    abortSignal?: AbortSignal,
): Promise<{ total: number; passed: number; failed: number; warnings: number; skipped: number }> {
    return new Promise((resolvePromise, reject) => {
        const targetAbs = resolve(process.cwd(), opts.target);
        const args = [resolve(SUITE_DIR, "conform"), "structural", targetAbs];
        if (opts.skip) args.push("--skip", opts.skip);
        for (const c of opts.components) args.push(`--${c}`);

        // Strip CLAUDECODE so nested bash scripts don't refuse to run
        const cleanEnv: Record<string, string | undefined> = {
            ...process.env,
            FORCE_COLOR: "0",
            TERM: "dumb",
        };
        delete cleanEnv.CLAUDECODE;

        const proc = spawn("bash", args, {
            cwd: SUITE_DIR,
            env: cleanEnv,
            stdio: ["ignore", "pipe", "pipe"],
        });

        const timer = withTimeout(proc, STRUCTURAL_TIMEOUT_MS, "Structural tests");

        // Allow external abort (e.g. --stop-on-fail in CI mode)
        if (abortSignal) {
            const onAbort = () => {
                proc.kill("SIGTERM");
            };
            abortSignal.addEventListener("abort", onAbort, { once: true });
            proc.on("close", () => abortSignal.removeEventListener("abort", onAbort));
        }

        let buffer = "";
        let currentComponent: ComponentType = "unknown";

        function sectionToComponent(section: string): ComponentType {
            const lower = section.toLowerCase();
            if (lower.startsWith("manifest")) return "manifest";
            if (lower.startsWith("skills")) return "skill";
            if (lower.startsWith("commands")) return "command";
            if (lower.startsWith("agents")) return "agent";
            if (lower.startsWith("hooks")) return "hook";
            return "unknown";
        }

        proc.stdout.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            // Safety: discard oversized buffer to prevent OOM
            if (buffer.length > MAX_BUFFER_BYTES) {
                buffer = buffer.slice(-MAX_BUFFER_BYTES);
            }
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                // Section headers: # === Plugin: name ===
                const sectionMatch = /^# === (.+) ===$/.exec(line);
                if (sectionMatch) {
                    onSection(sectionMatch[1]);
                    currentComponent = "manifest";
                    continue;
                }

                // Subsection: # --- Skills: name ---
                const subMatch = /^# --- (.+) ---$/.exec(line);
                if (subMatch) {
                    onSection(subMatch[1]);
                    currentComponent = sectionToComponent(subMatch[1]);
                    continue;
                }

                // TAP results: ok N - label or not ok N - label
                const result = parseTapLine(line);
                if (result) {
                    result.component = currentComponent;
                    onResult(result);
                }
            }
        });

        proc.on("close", (_code) => {
            clearTimeout(timer);
            // Process remaining buffer
            if (buffer.trim()) {
                const result = parseTapLine(buffer.trim());
                if (result) {
                    result.component = currentComponent;
                    onResult(result);
                }
            }

            // code 0 = pass, 1 = failures exist
            resolvePromise({
                total: 0, // filled in by component
                passed: 0,
                failed: 0,
                warnings: 0,
                skipped: 0,
            });
        });

        proc.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

// ── Integration line parsing ────────────────────────────────────────

const RESULT_RE = /^(PASS|WARN|FAIL|ERR|SKIP)\s+(?:\[(\w+)\]\s+)?\[(\d+)\/(\d+)\]\s+(\S+)\s+(.*)/;
const RUN_RE = /^RUN\s+(?:\[\w+\]\s+)?\[\d+\/(\d+)\]\s+(\S+)\s+"([^"]+)"/;

const VERDICT_MAP: Record<string, IntegrationVerdict> = {
    PASS: "pass",
    WARN: "warn",
    FAIL: "fail",
    ERR: "error",
    SKIP: "skip",
};

function parseIntegrationResultLine(clean: string): IntegrationResult | null {
    const m = RESULT_RE.exec(clean);
    if (!m) return null;

    const verdictRaw = m[1].trim();
    const typeTag = m[2] || "";
    const testId = m[5];
    const detail = m[6];

    const parts = testId.split("/");
    const plugin = parts[0] || "";
    const name = parts.slice(1).join("/") || "";

    const triggerMatch = /(?:trigger: )?"([^"]+)"/.exec(detail);
    const trigger = triggerMatch ? triggerMatch[1] : "";

    const costMatch = /\(\$([0-9.]+)\)/.exec(clean);
    const costUsd = costMatch ? parseFloat(costMatch[1]) : 0;

    const tokenMatch = /\[tokens:(\d+)\/(\d+)\/(\d+)\/(\d+)\]/.exec(clean);
    const tokens = tokenMatch
        ? {
              inputTokens: parseInt(tokenMatch[1], 10),
              outputTokens: parseInt(tokenMatch[2], 10),
              cacheReadInputTokens: parseInt(tokenMatch[3], 10),
              cacheCreationInputTokens: parseInt(tokenMatch[4], 10),
          }
        : null;

    let caseType = typeTag || "skill";
    if (!typeTag) {
        if (name.startsWith("cmd:")) caseType = "command";
        else if (name.startsWith("agent:")) caseType = "agent";
    }

    return {
        testId,
        plugin,
        name,
        type: caseType,
        trigger,
        verdict: VERDICT_MAP[verdictRaw] || "error",
        detail,
        costUsd,
        tokens,
    };
}

// ── Integration tests ───────────────────────────────────────────────

export function runIntegration(
    opts: CliOptions,
    onResult: (r: IntegrationResult) => void,
    onStart: (testId: string, trigger: string) => void,
    onTotal?: (total: number) => void,
): Promise<void> {
    return new Promise((resolvePromise, reject) => {
        const targetAbs = resolve(process.cwd(), opts.target);
        const args = [resolve(SUITE_DIR, "conform"), "integration", targetAbs];

        args.push("--model", opts.model);
        args.push("--max-turns", String(opts.maxTurns));
        args.push("--timeout", String(opts.timeout));
        args.push("--auth", opts.auth);
        if (opts.skip) args.push("--skip", opts.skip);
        if (opts.verbose) args.push("--verbose");
        if (opts.dryRun) args.push("--dry-run");
        if (opts.stopOnFail) args.push("--stop-on-fail");
        for (const c of opts.components) args.push(`--${c}`);

        // Strip CLAUDECODE so nested bash scripts don't refuse to run
        // Strip ANTHROPIC_API_KEY unless --auth api was explicitly passed,
        // so a globally set key doesn't trigger unintended API usage
        const cleanEnv: Record<string, string | undefined> = {
            ...process.env,
            FORCE_COLOR: "0",
            TERM: "dumb",
        };
        delete cleanEnv.CLAUDECODE;
        if (opts.auth !== "api") {
            delete cleanEnv.ANTHROPIC_API_KEY;
        }

        const proc = spawn("bash", args, {
            cwd: SUITE_DIR,
            env: cleanEnv,
            stdio: ["ignore", "pipe", "pipe"],
        });

        // Total timeout: per-test timeout * generous multiplier (account for startup, between-test overhead)
        const totalTimeoutMs = opts.timeout * 1000 * Math.max(20, opts.maxTurns * 2);
        const timer = withTimeout(proc, totalTimeoutMs, "Integration tests");

        let buffer = "";

        proc.stdout.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            // Safety: discard oversized buffer to prevent OOM
            if (buffer.length > MAX_BUFFER_BYTES) {
                buffer = buffer.slice(-MAX_BUFFER_BYTES);
            }
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                // Strip ANSI escape codes and split on \r (bash uses \r\033[K to overwrite RUN lines)
                const stripped = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
                const segments = stripped.split("\r");
                const clean = (segments[segments.length - 1] || "").trim();

                // Match result lines
                const totalMatch = RESULT_RE.exec(clean);
                if (totalMatch) {
                    const totalFromLine = parseInt(totalMatch[4], 10);
                    if (onTotal && totalFromLine > 0) onTotal(totalFromLine);
                }

                const result = parseIntegrationResultLine(clean);
                if (result) {
                    onResult(result);
                    continue;
                }

                // Match RUN lines for progress (check all segments since RUN is before \r)
                for (const seg of segments) {
                    const runMatch = RUN_RE.exec(seg.trim());
                    if (runMatch) {
                        const runTotal = parseInt(runMatch[1], 10);
                        if (onTotal && runTotal > 0) onTotal(runTotal);
                        onStart(runMatch[2], runMatch[3]);
                        break;
                    }
                }
            }
        });

        proc.on("close", () => {
            clearTimeout(timer);
            resolvePromise();
        });
        proc.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
