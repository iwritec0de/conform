import { join, relative } from "node:path";
import { isDir, listDir, fileExists } from "../utils.js";
import type { LintResult } from "../types.js";

/**
 * Scan for component files that exist outside their expected directories.
 *
 * Detects cases like:
 *   .claude/my-skill/SKILL.md       → should be under skills/
 *   .claude/my-command.md           → should be under commands/
 *   .claude/my-agent.md             → should be under agents/
 *
 * Only scans immediate subdirectories (not skills/, commands/, agents/, hooks/).
 */

const COMPONENT_DIRS = new Set(["skills", "commands", "agents", "hooks"]);
const IGNORE_DIRS = new Set([
    ".claude-plugin",
    "references",
    "teams",
    "worktrees",
    "node_modules",
    ".git",
    "src",
    "lib",
    "dist",
    "build",
    "tests",
    "test",
    "__tests__",
    "docs",
    "scripts",
    "fixtures",
    "examples",
    "integration",
    "coverage",
]);

const IGNORE_MD_FILES = new Set([
    "readme.md",
    "claude.md",
    "changelog.md",
    "startup.md",
    "contributing.md",
    "security.md",
    "code_of_conduct.md",
    "license.md",
    "authors.md",
    "history.md",
    "todo.md",
]);

export function lintMisplaced(pluginDir: string): LintResult[] {
    const results: LintResult[] = [];

    // Scan subdirectories of pluginDir that aren't standard component dirs
    const entries = listDir(pluginDir);

    for (const entry of entries) {
        if (COMPONENT_DIRS.has(entry) || IGNORE_DIRS.has(entry)) continue;
        if (entry.startsWith(".")) continue;

        const entryPath = join(pluginDir, entry);

        // Check for SKILL.md in a subdirectory (misplaced skill)
        if (isDir(entryPath)) {
            const skillMd = join(entryPath, "SKILL.md");
            const skillMdLower = join(entryPath, "skill.md");
            if (fileExists(skillMd) || fileExists(skillMdLower)) {
                const rel = relative(pluginDir, entryPath);
                results.push({
                    rule: "misplaced/skill-outside-skills-dir",
                    severity: "warning",
                    message: `Found SKILL.md in ${rel}/ — should be under skills/${entry}/`,
                    file: fileExists(skillMd) ? skillMd : skillMdLower,
                    detail: `Move to skills/${entry}/SKILL.md`,
                });
            }
        }

        // Check for .md files at root that look like commands (have frontmatter with name/description)
        if (!isDir(entryPath) && entry.endsWith(".md")) {
            // Skip common non-component / repo files
            const lower = entry.toLowerCase();
            if (IGNORE_MD_FILES.has(lower)) {
                continue;
            }

            // Could be a misplaced command — warn about it
            const slug = entry.replace(/\.md$/, "");
            results.push({
                rule: "misplaced/md-outside-commands-dir",
                severity: "info",
                message: `Found ${entry} at root — if this is a command, move to commands/${entry}`,
                file: entryPath,
                detail: `Slash commands belong in commands/${slug}.md`,
            });
        }
    }

    return results;
}
