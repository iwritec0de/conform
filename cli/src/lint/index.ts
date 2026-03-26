import { resolve, basename, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { isDir, listDir, listFiles } from "./utils.js";
import { lintManifest } from "./rules/manifest.js";
import { lintSkills } from "./rules/skills.js";
import { lintCommands } from "./rules/commands.js";
import { lintAgents } from "./rules/agents.js";
import { lintHooks } from "./rules/hooks.js";
import { lintMisplaced } from "./rules/misplaced.js";
import { lintPluginSchema, lintMarketplaceSchema } from "./rules/schema.js";
import type { LintResult, LintSummary, LintOptions, LintScanned } from "./types.js";

export type { LintResult, LintSummary, LintOptions, LintScanned } from "./types.js";
export type { Severity } from "./types.js";

export interface ConformConfig {
    rules?: {
        disable?: string[];
    };
    maxDescLength?: number;
}

const CONFIG_NAMES = ["conform.yml", "conform.yaml"];

function parseSimpleYaml(content: string): ConformConfig {
    const config: ConformConfig = {};
    const lines = content.split("\n");
    let inRules = false;
    let inDisable = false;

    for (const line of lines) {
        const trimmed = line.trimEnd();

        if (/^rules:\s*$/.test(trimmed)) {
            inRules = true;
            inDisable = false;
            continue;
        }

        if (inRules && /^\s+disable:\s*$/.test(trimmed)) {
            inDisable = true;
            config.rules ??= {};
            config.rules.disable ??= [];
            continue;
        }

        if (inDisable) {
            const listMatch = /^\s+-\s+(.+)/.exec(trimmed);
            if (listMatch) {
                config.rules?.disable?.push(listMatch[1].trim());
                continue;
            }
            inDisable = false;
        }

        if (/^[a-zA-Z]/.test(trimmed)) {
            inRules = false;
            inDisable = false;
        }

        const kvMatch = /^maxDescLength:\s*(\d+)/.exec(trimmed);
        if (kvMatch) {
            config.maxDescLength = parseInt(kvMatch[1], 10);
        }
    }

    return config;
}

/**
 * Load conform config from a YAML file.
 * Searches target dir then CWD for conform.yml/conform.yaml.
 */
export function loadConfig(configPath?: string, searchDirs?: string[]): ConformConfig {
    if (configPath) {
        if (!existsSync(configPath)) return {};
        return parseSimpleYaml(readFileSync(configPath, "utf-8"));
    }

    const dirs = searchDirs ?? [process.cwd()];
    for (const dir of dirs) {
        for (const name of CONFIG_NAMES) {
            const candidate = resolve(dir, name);
            if (existsSync(candidate)) {
                return parseSimpleYaml(readFileSync(candidate, "utf-8"));
            }
        }
    }

    return {};
}

/**
 * Resolve the effective plugin root.
 * If the target has a .claude/ subdir with components, use that.
 */
function resolvePluginRoot(dir: string): string {
    const stdDirs = [".claude-plugin", "skills", "commands", "agents", "hooks"];
    for (const d of stdDirs) {
        if (isDir(resolve(dir, d))) return dir;
    }
    const claudeDir = resolve(dir, ".claude");
    if (isDir(claudeDir)) {
        const innerDirs = ["commands", "skills", "agents", "hooks"];
        for (const d of innerDirs) {
            if (isDir(resolve(claudeDir, d))) return claudeDir;
        }
    }
    return dir;
}

/**
 * Lint a Claude Code plugin directory.
 *
 * @param target - Path to a plugin directory or project with .claude/
 * @param options - Optional lint configuration
 * @returns Structured lint summary with all findings
 */
export function lint(target: string, options: LintOptions = {}): LintSummary {
    const targetAbs = resolve(target);
    const pluginRoot = resolvePluginRoot(targetAbs);
    const components = options.components ?? ["skills", "commands", "agents", "hooks"];

    const results: LintResult[] = [];

    // Always check manifest (only produces results if .claude-plugin/ exists)
    results.push(...lintManifest(pluginRoot));

    if (components.includes("skills")) {
        results.push(...lintSkills(pluginRoot, options.maxDescLength));
    }
    if (components.includes("commands")) {
        results.push(...lintCommands(pluginRoot));
    }
    if (components.includes("agents")) {
        results.push(...lintAgents(pluginRoot));
    }
    if (components.includes("hooks")) {
        // $CLAUDE_PROJECT_DIR is the project root, not the .claude dir itself
        const projectRoot =
            basename(pluginRoot) === ".claude" ? resolve(pluginRoot, "..") : targetAbs;
        results.push(...lintHooks(pluginRoot, projectRoot));
    }

    // Always check for misplaced component files
    results.push(...lintMisplaced(pluginRoot));

    // JSON Schema validation for plugin.json and marketplace.json
    results.push(...lintPluginSchema(pluginRoot));
    results.push(...lintMarketplaceSchema(pluginRoot));

    // Count what was scanned
    const skillsDir = join(pluginRoot, "skills");
    const cmdsDir = join(pluginRoot, "commands");
    const agentsDir = join(pluginRoot, "agents");
    const hooksDir = join(pluginRoot, "hooks");
    const scanned: LintScanned = {
        skills: isDir(skillsDir)
            ? listDir(skillsDir).filter((d) => isDir(join(skillsDir, d))).length
            : 0,
        commands: isDir(cmdsDir) ? listFiles(cmdsDir, ".md").length : 0,
        agents: isDir(agentsDir) ? listFiles(agentsDir, ".md").length : 0,
        hooks:
            isDir(hooksDir) &&
            (existsSync(join(hooksDir, "hooks.json")) ||
                existsSync(join(pluginRoot, "settings.json")))
                ? 1
                : 0,
        manifest: isDir(join(pluginRoot, ".claude-plugin")),
    };

    // Remove disabled rules
    const disabled = new Set(options.disable ?? []);
    const active = disabled.size > 0 ? results.filter((r) => !disabled.has(r.rule)) : results;

    const errors = active.filter((r) => r.severity === "error").length;
    const warnings = active.filter((r) => r.severity === "warning").length;
    const infos = active.filter((r) => r.severity === "info").length;

    // Filter out info results unless verbose
    const filtered = options.verbose ? active : active.filter((r) => r.severity !== "info");

    return {
        target: targetAbs,
        errors,
        warnings,
        infos,
        passed: errors === 0,
        results: filtered,
        scanned,
    };
}
