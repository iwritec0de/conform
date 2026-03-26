import { join } from "node:path";
import { isDir, listFiles, readFile, isKebabCase, parseFrontmatter } from "../utils.js";
import type { LintResult } from "../types.js";

const VALID_MODELS = new Set(["haiku", "sonnet", "opus"]);

export function lintAgents(pluginDir: string): LintResult[] {
    const results: LintResult[] = [];
    const agentsDir = join(pluginDir, "agents");

    if (!isDir(agentsDir)) {
        return results;
    }

    const mdFiles = listFiles(agentsDir, ".md");
    if (mdFiles.length === 0) {
        results.push({
            rule: "agent/has-agents",
            severity: "info",
            message: "agents/ directory has no .md files",
            file: agentsDir,
        });
        return results;
    }

    for (const file of mdFiles) {
        const agentName = file.replace(/\.md$/, "");
        const prefix = `agent/${agentName}`;
        const filePath = join(agentsDir, file);
        const content = readFile(filePath);
        const fm = parseFrontmatter(content);

        if (!fm) {
            results.push({
                rule: "agent/valid-frontmatter",
                severity: "error",
                message: `${prefix}: missing or invalid YAML frontmatter`,
                file: filePath,
            });
            continue;
        }

        // Name
        if (!fm.fields.name) {
            results.push({
                rule: "agent/has-name",
                severity: "error",
                message: `${prefix}: frontmatter missing 'name' field`,
                file: filePath,
            });
        } else if (!isKebabCase(fm.fields.name)) {
            results.push({
                rule: "agent/name-kebab-case",
                severity: "warning",
                message: `${prefix}: name should be kebab-case`,
                file: filePath,
            });
        }

        // Description
        if (!fm.fields.description) {
            results.push({
                rule: "agent/has-description",
                severity: "error",
                message: `${prefix}: frontmatter missing 'description' field`,
                file: filePath,
            });
        }

        // Model
        if (!fm.fields.model) {
            results.push({
                rule: "agent/has-model",
                severity: "error",
                message: `${prefix}: frontmatter missing 'model' field`,
                file: filePath,
            });
        } else if (!VALID_MODELS.has(fm.fields.model)) {
            results.push({
                rule: "agent/valid-model",
                severity: "warning",
                message: `${prefix}: unknown model "${fm.fields.model}" (expected: ${[...VALID_MODELS].join(", ")})`,
                file: filePath,
            });
        }

        // Tools
        if (!fm.fields.tools) {
            results.push({
                rule: "agent/has-tools",
                severity: "error",
                message: `${prefix}: frontmatter missing 'tools' field`,
                file: filePath,
            });
        }

        // Body content
        if (fm.bodyWordCount < 5) {
            results.push({
                rule: "agent/has-body",
                severity: "warning",
                message: `${prefix}: agent body has very little content (${fm.bodyWordCount} words)`,
                file: filePath,
            });
        }
    }

    return results;
}
