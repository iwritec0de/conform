import { join } from "node:path";
import { isDir, listFiles, readFile, parseFrontmatter } from "../utils.js";
import type { LintResult } from "../types.js";

export function lintCommands(pluginDir: string): LintResult[] {
    const results: LintResult[] = [];
    const cmdsDir = join(pluginDir, "commands");

    if (!isDir(cmdsDir)) {
        return results;
    }

    const mdFiles = listFiles(cmdsDir, ".md");
    if (mdFiles.length === 0) {
        results.push({
            rule: "command/has-commands",
            severity: "info",
            message: "commands/ directory has no .md files",
            file: cmdsDir,
        });
        return results;
    }

    for (const file of mdFiles) {
        const cmdName = file.replace(/\.md$/, "");
        const prefix = `command/${cmdName}`;
        const filePath = join(cmdsDir, file);
        const content = readFile(filePath);
        const fm = parseFrontmatter(content);

        if (fm) {
            // Has frontmatter — validate fields
            if (!fm.fields.description) {
                results.push({
                    rule: "command/has-description",
                    severity: "error",
                    message: `${prefix}: frontmatter present but missing 'description'`,
                    file: filePath,
                });
            }
        } else {
            // No frontmatter — check for # Title format
            const firstLine = content.split("\n")[0]?.trim() ?? "";
            if (!firstLine.startsWith("# ")) {
                results.push({
                    rule: "command/valid-format",
                    severity: "error",
                    message: `${prefix}: no frontmatter and no # Title heading`,
                    file: filePath,
                });
            } else {
                results.push({
                    rule: "command/missing-frontmatter",
                    severity: "warning",
                    message: `${prefix}: using # Title format — YAML frontmatter with 'description' is recommended`,
                    file: filePath,
                });
            }
        }
    }

    return results;
}
