#!/usr/bin/env node
/**
 * Interactive CLI to generate test-prompts.json for the response-log mode.
 *
 * Usage:
 *   npx tsx src/gen-prompts.ts <plugin-dir> [output-path]
 *   npx tsx src/gen-prompts.ts ./my-plugin
 *   npx tsx src/gen-prompts.ts ./my-plugin ./my-plugin/test-prompts.json
 *
 * Scans the plugin directory, walks through each discovered component,
 * and builds test prompts interactively.
 */

import { createInterface } from "node:readline";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import type { ResponseLogPrompt, ResponseLogExpect } from "./types.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> =>
    new Promise((res) => rl.question(q, (a) => res(a.trim())));

// ANSI helpers
const A = {
    bold: "\x1b[1m",
    dim: "\x1b[90m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    magenta: "\x1b[35m",
    white: "\x1b[37m",
    reset: "\x1b[0m",
};

// ── Discover components from a plugin dir ────────────────────────────

type ComponentKind = "skill" | "command" | "agent";

interface DiscoveredComponent {
    type: ComponentKind;
    name: string;
    description: string;
}

function extractDescription(filePath: string): string {
    try {
        const content = readFileSync(filePath, "utf-8");
        // eslint-disable-next-line sonarjs/slow-regex -- bounded by small frontmatter blocks
        const fmMatch = /^---\s*\n([\s\S]*?)\n---/.exec(content);
        if (!fmMatch) return "";
        const fm = fmMatch[1];
        // Handle multi-line >- descriptions
        // eslint-disable-next-line sonarjs/slow-regex -- bounded by small frontmatter blocks
        const descMatch = /^description:\s*>-?\s*\n((?:\s+.+\n?)+)/m.exec(fm);
        if (descMatch) {
            return descMatch[1]
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .join(" ")
                .slice(0, 120);
        }
        // Single-line description
        const singleMatch = /^description:\s*(.+)/m.exec(fm);
        if (singleMatch) return singleMatch[1].replace(/^["']|["']$/g, "").slice(0, 120);
        return "";
    } catch {
        return "";
    }
}

function discoverInRoot(root: string): DiscoveredComponent[] {
    const components: DiscoveredComponent[] = [];

    // Skills
    const skillsDir = join(root, "skills");
    if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
        for (const entry of readdirSync(skillsDir)) {
            const full = join(skillsDir, entry);
            const skillFile = join(full, "SKILL.md");
            if (statSync(full).isDirectory() && existsSync(skillFile)) {
                components.push({
                    type: "skill",
                    name: entry,
                    description: extractDescription(skillFile),
                });
            }
        }
    }

    // Commands
    const cmdsDir = join(root, "commands");
    if (existsSync(cmdsDir) && statSync(cmdsDir).isDirectory()) {
        for (const entry of readdirSync(cmdsDir)) {
            if (entry.endsWith(".md")) {
                const name = entry.replace(/\.md$/, "");
                components.push({
                    type: "command",
                    name,
                    description: extractDescription(join(cmdsDir, entry)),
                });
            }
        }
    }

    // Agents
    const agentsDir = join(root, "agents");
    if (existsSync(agentsDir) && statSync(agentsDir).isDirectory()) {
        for (const entry of readdirSync(agentsDir)) {
            if (entry.endsWith(".md")) {
                const name = entry.replace(/\.md$/, "");
                components.push({
                    type: "agent",
                    name,
                    description: extractDescription(join(agentsDir, entry)),
                });
            }
        }
    }

    return components;
}

function discoverComponents(dir: string): DiscoveredComponent[] {
    const roots = [dir];
    const claudeDir = join(dir, ".claude");
    if (existsSync(claudeDir) && statSync(claudeDir).isDirectory()) {
        roots.push(claudeDir);
    }

    const components: DiscoveredComponent[] = [];
    for (const root of roots) {
        components.push(...discoverInRoot(root));
    }
    return components;
}

// ── Component type colors ────────────────────────────────────────────

const TYPE_COLOR: Record<ComponentKind, string> = {
    skill: A.cyan,
    command: A.magenta,
    agent: A.yellow,
};

function typeLabel(type: ComponentKind): string {
    return `${TYPE_COLOR[type]}[${type}]${A.reset}`;
}

// ── Prompt generation ────────────────────────────────────────────────

function generateDefaultId(type: ComponentKind, name: string, index: number): string {
    return `${type}-${name}-${index + 1}`;
}

function generateDefaultPrompt(type: ComponentKind, name: string, desc: string): string {
    if (type === "command") return `/${name}`;
    if (desc) {
        // Extract a usable trigger from the description
        const lower = desc.toLowerCase();
        const triggerPatterns = [
            /(?:when|if)\s+(?:the\s+)?user\s+(?:asks?\s+to\s+|wants?\s+to\s+)(.{10,60})/i,
            /(?:use\s+(?:this\s+)?(?:to|for|when)\s+)(.{10,60})/i,
            /(?:trigger(?:ed|s)?\s+(?:when|by)\s+)(.{10,60})/i,
        ];
        for (const re of triggerPatterns) {
            const m = re.exec(lower);
            // eslint-disable-next-line sonarjs/slow-regex -- short strings only
            if (m) return m[1].replace(/[.,"]+$/, "").trim();
        }
        // Fall back to first sentence
        const firstSentence = desc.split(/[.!?]/)[0];
        if (firstSentence && firstSentence.length > 10) return firstSentence.trim();
    }
    return `Help me with ${name.replace(/-/g, " ")}`;
}

async function buildPromptForComponent(
    comp: DiscoveredComponent,
    index: number,
): Promise<ResponseLogPrompt | null> {
    const defaultId = generateDefaultId(comp.type, comp.name, index);
    const defaultPrompt = generateDefaultPrompt(comp.type, comp.name, comp.description);

    console.log(`\n${A.bold}${typeLabel(comp.type)} ${A.bold}${comp.name}${A.reset}`);
    if (comp.description) {
        console.log(`${A.dim}  ${comp.description}${A.reset}`);
    }

    const action = await ask(
        `  ${A.dim}(enter)${A.reset} add  ${A.dim}(s)${A.reset} skip  ${A.dim}(q)${A.reset} done: `,
    );

    if (action.toLowerCase() === "q") return null;
    if (action.toLowerCase() === "s") {
        console.log(`${A.dim}  skipped${A.reset}`);
        // Return sentinel with empty prompt to indicate skip
        return { id: "", component: comp.type, name: comp.name, prompt: "" };
    }

    // Prompt text
    console.log(`${A.dim}  suggested: "${defaultPrompt}"${A.reset}`);
    const promptInput = await ask(`  prompt (enter for suggested): `);
    const prompt = promptInput || defaultPrompt;

    // Expectations — auto-fill the component loaded check
    const expect: ResponseLogExpect = {};
    if (comp.type === "skill") expect.skillLoaded = comp.name;
    else if (comp.type === "command") expect.commandLoaded = comp.name;
    else if (comp.type === "agent") expect.agentLoaded = comp.name;

    // Optional: responseContains
    const contains = await ask(
        `  response must contain ${A.dim}(comma-separated, or enter to skip)${A.reset}: `,
    );
    if (contains) {
        expect.responseContains = contains
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    }

    // Optional: responseNotContains
    const notContains = await ask(
        `  response must NOT contain ${A.dim}(comma-separated, or enter to skip)${A.reset}: `,
    );
    if (notContains) {
        expect.responseNotContains = notContains
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    }

    const entry: ResponseLogPrompt = {
        id: defaultId,
        component: comp.type,
        name: comp.name,
        prompt,
    };

    if (Object.keys(expect).length > 0) {
        entry.expect = expect;
    }

    console.log(`${A.green}  + added${A.reset}`);
    return entry;
}

// ── Main ─────────────────────────────────────────────────────────────

function printHelp(): void {
    console.log(`
${A.bold}${A.cyan}gen-prompts${A.reset} — Generate test-prompts.json for response-log mode

${A.bold}USAGE${A.reset}
  conform gen-prompts <plugin-dir> [output-path]

${A.bold}OUTPUT${A.reset}
  Defaults to <plugin-dir>/test-prompts.json if no output path is given.

${A.bold}EXAMPLES${A.reset}
  conform gen-prompts ./my-plugin                              ${A.dim}# writes ./my-plugin/test-prompts.json${A.reset}
  conform gen-prompts ./my-plugin ./tests/my-prompts.json      ${A.dim}# custom output path${A.reset}
  conform gen-prompts .claude                                  ${A.dim}# writes .claude/test-prompts.json${A.reset}

Scans the plugin for skills, commands, and agents, then walks you
through each one to build test prompts with expectations.
`);
}

function resolvePluginDir(pluginArg: string): string {
    if (pluginArg.endsWith(".json")) {
        console.error(
            `Error: expected a plugin directory, got a JSON file: ${pluginArg}\n\n` +
                `  Usage: conform gen-prompts <plugin-dir> [output-path]\n\n` +
                `  Example:\n` +
                `    conform gen-prompts ./my-plugin\n` +
                `    conform gen-prompts ./my-plugin ./custom-prompts.json`,
        );
        process.exit(1);
    }

    const pluginDir = resolve(pluginArg);
    if (!existsSync(pluginDir)) {
        console.error(`Error: directory not found: ${pluginDir}`);
        process.exit(1);
    }

    if (!statSync(pluginDir).isDirectory()) {
        console.error(`Error: not a directory: ${pluginDir}`);
        process.exit(1);
    }

    return pluginDir;
}

async function main() {
    const args = process.argv.slice(2);

    if (args.includes("--help") || args.includes("-h") || args.length === 0) {
        printHelp();
        rl.close();
        return;
    }

    const pluginDir = resolvePluginDir(args[0]);
    const pluginName = basename(pluginDir);
    const outputPath = args[1] || join(pluginDir, "test-prompts.json");

    // Discover components
    const discovered = discoverComponents(pluginDir);
    if (discovered.length === 0) {
        console.error(
            `Error: no skills, commands, or agents found in ${pluginName}.\n\n` +
                `  Expected a plugin directory containing skills/, commands/, or agents/,\n` +
                `  or a .claude directory with these components.\n\n` +
                `  Usage: conform gen-prompts <plugin-dir>`,
        );
        rl.close();
        process.exit(1);
    }

    console.log(
        `\n${A.bold}${A.cyan}${pluginName}${A.reset} — ${discovered.length} component(s) found`,
    );
    console.log(`${A.dim}output: ${outputPath}${A.reset}\n`);

    const byType = { skill: 0, command: 0, agent: 0 };
    for (const c of discovered) {
        byType[c.type]++;
        const descSuffix = c.description
            ? `${A.dim} — ${c.description.slice(0, 60)}${A.reset}`
            : "";
        console.log(`  ${typeLabel(c.type)} ${c.name}${descSuffix}`);
    }
    console.log();

    const counts = [];
    if (byType.skill) counts.push(`${byType.skill} skill${byType.skill > 1 ? "s" : ""}`);
    if (byType.command) counts.push(`${byType.command} command${byType.command > 1 ? "s" : ""}`);
    if (byType.agent) counts.push(`${byType.agent} agent${byType.agent > 1 ? "s" : ""}`);
    console.log(
        `${A.dim}Walking through ${counts.join(", ")}. ` +
            `Press enter to accept defaults, 's' to skip, 'q' to finish early.${A.reset}`,
    );

    // Load existing prompts
    let prompts: ResponseLogPrompt[] = [];
    if (existsSync(outputPath)) {
        try {
            prompts = JSON.parse(readFileSync(outputPath, "utf-8")) as ResponseLogPrompt[];
            console.log(
                `${A.dim}Loaded ${prompts.length} existing prompt(s) from ${basename(outputPath)}${A.reset}`,
            );
        } catch {
            // start fresh
        }
    }

    // Existing keys for dedup
    const existingNames = new Set(prompts.map((p) => `${p.component}:${p.name}`));

    let added = 0;
    let skipped = 0;

    for (let i = 0; i < discovered.length; i++) {
        const comp = discovered[i];
        const key = `${comp.type}:${comp.name}`;

        if (existingNames.has(key)) {
            console.log(
                `\n${A.dim}  ${typeLabel(comp.type)} ${comp.name} — already in prompts file, skipping${A.reset}`,
            );
            skipped++;
            continue;
        }

        const entry = await buildPromptForComponent(comp, i);

        if (entry === null) {
            // 'q' — done early
            break;
        }

        if (entry.prompt === "") {
            // skip sentinel
            skipped++;
            continue;
        }

        prompts.push(entry);
        existingNames.add(key);
        added++;
    }

    if (added === 0) {
        console.log(`\n${A.dim}No prompts added.${A.reset}`);
        rl.close();
        return;
    }

    // Write output
    writeFileSync(outputPath, JSON.stringify(prompts, null, 2) + "\n", "utf-8");
    console.log(
        `\n${A.green}${A.bold}+ Wrote ${prompts.length} prompt(s)${A.reset} to ${basename(outputPath)}` +
            `${A.dim} (${added} new, ${skipped} skipped)${A.reset}`,
    );
    console.log(`\n${A.dim}Run: conform response-log ${pluginDir} --dry-run${A.reset}\n`);

    rl.close();
}

main().catch((err) => {
    console.error(err);
    rl.close();
    process.exit(1);
});
