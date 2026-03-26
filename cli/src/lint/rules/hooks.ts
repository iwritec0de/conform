import { join } from "node:path";
import { fileExists, readFile, parseJson, isDir } from "../utils.js";
import type { LintResult, HookEntry, HooksConfig } from "../types.js";

const VALID_EVENTS = new Set([
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "Notification",
    "SubagentStop",
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "PreCompact",
]);

const SHELL_BUILTINS = new Set([
    "bash",
    "sh",
    "python3",
    "python",
    "node",
    "echo",
    "printf",
    "cat",
    "true",
    "false",
    "test",
]);

// Shell keywords and operators that are not the actual command being executed.
// When a hook command starts with these, we skip past them to find the real script.
const SHELL_SKIP_TOKENS = new Set([
    // Control flow
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "while",
    "until",
    "do",
    "done",
    "case",
    "esac",
    "in",
    // Logical operators / separators
    "!",
    "&&",
    "||",
    ";",
    ";;",
    "{",
    "}",
    // Common prefixes
    "env",
    "exec",
    "nohup",
    "sudo",
    "command",
    "builtin",
    "time",
]);

/** Returns true if the token is a shell syntax element (not a real command). */
function isShellSyntax(token: string): boolean {
    if (SHELL_SKIP_TOKENS.has(token)) return true;
    if (/^[A-Za-z_]\w*=/.test(token)) return true;
    if (/^\$/.test(token)) return true;
    if (/^\d*>{1,2}|^<|^&>|^\/dev\/null$/.test(token)) return true;
    if (token === "|" || token === "&" || token === ";") return true;
    if (token.endsWith(";") && SHELL_SKIP_TOKENS.has(token.slice(0, -1))) return true;
    return false;
}

/**
 * Extract the actual script/executable path from a resolved shell command string.
 *
 * Tracks bracket depth for test expressions ([ ] / [[ ]]) and parenthesis depth
 * for subshells/command substitutions ($(...) which becomes (...) after quote stripping).
 * Skips shell keywords, variable assignments, redirections, and operators to find
 * the first real command token.
 */
function extractScriptPath(resolved: string): string | null {
    const tokens = resolved.split(/\s+/).filter(Boolean);
    let testDepth = 0;
    let parenDepth = 0;

    for (const token of tokens) {
        // Count opening/closing parens within the token
        const opens = (token.match(/\(/g) || []).length;
        const closes = (token.match(/\)/g) || []).length;

        // Track test expression brackets — skip everything inside [ ] and [[ ]]
        if (testDepth === 0 && parenDepth === 0 && (token === "[" || token === "[[")) {
            testDepth++;
            continue;
        }
        if (testDepth > 0) {
            if (token === "]" || token === "]]" || token.endsWith("];") || token.endsWith("]]")) {
                testDepth--;
            }
            continue;
        }

        // Track subshell/command-substitution parens
        if (opens > 0 || closes > 0) {
            parenDepth += opens - closes;
            if (parenDepth < 0) parenDepth = 0;
            continue;
        }
        if (parenDepth > 0) continue;

        if (isShellSyntax(token)) continue;

        // This looks like an actual command or script path
        return token;
    }

    return null;
}

function validateHookEntry(
    entry: HookEntry,
    prefix: string,
    pluginDir: string,
    projectRoot: string,
    results: LintResult[],
): void {
    const hookType = entry.type ?? "";

    if (hookType !== "command" && hookType !== "prompt") {
        results.push({
            rule: "hooks/valid-type",
            severity: "error",
            message: `${prefix}: type must be "command" or "prompt", got "${hookType}"`,
        });
        return;
    }

    if (hookType === "command") {
        const cmd = entry.command ?? "";
        if (!cmd) {
            results.push({
                rule: "hooks/command-field",
                severity: "error",
                message: `${prefix}: command hook missing "command" field`,
            });
        } else {
            // Resolve variables, strip shell quotes, then extract the actual script
            const resolved = cmd
                .replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT/g, pluginDir)
                .replace(/\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR/g, projectRoot)
                .replace(/['"]/g, "");
            const scriptPath = extractScriptPath(resolved);

            if (scriptPath && !SHELL_BUILTINS.has(scriptPath) && !fileExists(scriptPath)) {
                results.push({
                    rule: "hooks/script-exists",
                    severity: "warning",
                    message: `${prefix}: script not found: ${scriptPath}`,
                    detail: `Resolved from: ${cmd}`,
                });
            }
        }
    }

    if (hookType === "prompt") {
        if (!entry.prompt) {
            results.push({
                rule: "hooks/prompt-field",
                severity: "error",
                message: `${prefix}: prompt hook missing "prompt" field`,
            });
        }
    }
}

function findHooksFile(pluginDir: string): string {
    const hooksJsonPath = join(pluginDir, "hooks", "hooks.json");
    const settingsPath = join(pluginDir, "settings.json");

    if (isDir(join(pluginDir, "hooks")) && fileExists(hooksJsonPath)) {
        return hooksJsonPath;
    }

    if (fileExists(settingsPath)) {
        const content = readFile(settingsPath);
        const parsed = parseJson(content);
        if (
            parsed.ok &&
            typeof parsed.data === "object" &&
            parsed.data !== null &&
            "hooks" in parsed.data
        ) {
            return settingsPath;
        }
    }

    return "";
}

function validateEventHooks(
    eventName: string,
    eventHooks: unknown,
    pluginDir: string,
    resolvedRoot: string,
    hooksFile: string,
): LintResult[] {
    const results: LintResult[] = [];

    if (!VALID_EVENTS.has(eventName)) {
        results.push({
            rule: "hooks/valid-event",
            severity: "warning",
            message: `Unknown hook event: ${eventName}`,
            file: hooksFile,
            detail: `Valid events: ${[...VALID_EVENTS].join(", ")}`,
        });
    }

    if (!Array.isArray(eventHooks)) {
        results.push({
            rule: "hooks/event-is-array",
            severity: "error",
            message: `${eventName}: must be an array`,
            file: hooksFile,
        });
        return results;
    }

    for (let i = 0; i < eventHooks.length; i++) {
        const rawHook: unknown = eventHooks[i];
        if (typeof rawHook !== "object" || rawHook === null) {
            results.push({
                rule: "hooks/entry-is-object",
                severity: "error",
                message: `${eventName}[${i}]: must be an object`,
                file: hooksFile,
            });
            continue;
        }
        const hook = rawHook as HookEntry;

        // Each entry must be a hookMatcherGroup: { hooks: [...], matcher?: string }
        if (!hook.hooks) {
            // Flat format detected — the runtime requires the nested format
            const hasType = "type" in hook;
            const hasCommand = "command" in hook;
            const hasPrompt = "prompt" in hook;

            if (hasType || hasCommand || hasPrompt) {
                results.push({
                    rule: "hooks/requires-nested-format",
                    severity: "error",
                    message: `${eventName}[${i}]: hook entries must use the nested format with a "hooks" array. Wrap this entry: { "hooks": [{ "type": "${hook.type ?? "command"}", ... }]${hook.matcher ? `, "matcher": "${hook.matcher}"` : ""} }`,
                    file: hooksFile,
                });
            } else {
                results.push({
                    rule: "hooks/requires-nested-format",
                    severity: "error",
                    message: `${eventName}[${i}]: missing required "hooks" array`,
                    file: hooksFile,
                });
            }
            continue;
        }

        if (!Array.isArray(hook.hooks)) {
            results.push({
                rule: "hooks/nested-is-array",
                severity: "error",
                message: `${eventName}[${i}]: "hooks" must be an array`,
                file: hooksFile,
            });
            continue;
        }

        if (hook.hooks.length === 0) {
            results.push({
                rule: "hooks/nested-is-array",
                severity: "error",
                message: `${eventName}[${i}]: "hooks" array must not be empty`,
                file: hooksFile,
            });
            continue;
        }

        for (let j = 0; j < hook.hooks.length; j++) {
            const rawInner: unknown = hook.hooks[j];
            if (typeof rawInner !== "object" || rawInner === null) {
                results.push({
                    rule: "hooks/nested-entry-is-object",
                    severity: "error",
                    message: `${eventName}[${i}].hooks[${j}]: must be an object`,
                    file: hooksFile,
                });
                continue;
            }
            validateHookEntry(
                rawInner as HookEntry,
                `${eventName}[${i}].hooks[${j}]`,
                pluginDir,
                resolvedRoot,
                results,
            );
        }
    }

    return results;
}

export function lintHooks(pluginDir: string, projectRoot?: string): LintResult[] {
    const resolvedRoot = projectRoot ?? pluginDir;
    const results: LintResult[] = [];

    const hooksFile = findHooksFile(pluginDir);
    if (!hooksFile) {
        return results;
    }

    // Parse JSON
    const content = readFile(hooksFile);
    const parsed = parseJson(content);
    if (!parsed.ok) {
        results.push({
            rule: "hooks/valid-json",
            severity: "error",
            message: "Hooks file is not valid JSON",
            file: hooksFile,
            detail: parsed.error,
        });
        return results;
    }

    const data = parsed.data as HooksConfig;
    if (!data.hooks || typeof data.hooks !== "object") {
        results.push({
            rule: "hooks/has-hooks-key",
            severity: "error",
            message: 'Missing top-level "hooks" key',
            file: hooksFile,
        });
        return results;
    }

    // Validate each event
    for (const [eventName, eventHooks] of Object.entries(data.hooks)) {
        results.push(
            ...validateEventHooks(eventName, eventHooks, pluginDir, resolvedRoot, hooksFile),
        );
    }

    return results;
}
