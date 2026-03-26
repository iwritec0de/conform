import { join } from "node:path";
import {
    isDir,
    listDir,
    fileExists,
    readFile,
    isKebabCase,
    parseFrontmatter,
    listFiles,
} from "../utils.js";
import type { LintResult } from "../types.js";

const RESERVED_NAMES = new Set(["test", "example", "template", "sample", "demo", "default"]);
const DEFAULT_MAX_DESC_CHARS = 1024;
const MAX_BODY_WORDS = 5000;

// Common plugin verbs — base form (imperative) triggers a warning
const IMPERATIVE_VERBS = new Set([
    "add",
    "analyze",
    "apply",
    "build",
    "call",
    "change",
    "check",
    "clean",
    "compile",
    "configure",
    "connect",
    "convert",
    "copy",
    "create",
    "debug",
    "delete",
    "deploy",
    "detect",
    "download",
    "edit",
    "execute",
    "export",
    "extract",
    "fetch",
    "find",
    "fix",
    "format",
    "generate",
    "get",
    "handle",
    "help",
    "import",
    "initialize",
    "insert",
    "install",
    "lint",
    "list",
    "load",
    "log",
    "manage",
    "merge",
    "migrate",
    "modify",
    "monitor",
    "move",
    "open",
    "optimize",
    "parse",
    "patch",
    "process",
    "publish",
    "query",
    "read",
    "refactor",
    "remove",
    "rename",
    "render",
    "replace",
    "reset",
    "resolve",
    "restart",
    "restore",
    "retrieve",
    "review",
    "run",
    "save",
    "scaffold",
    "scan",
    "search",
    "send",
    "serve",
    "set",
    "setup",
    "show",
    "start",
    "stop",
    "store",
    "submit",
    "sync",
    "test",
    "track",
    "transform",
    "trigger",
    "update",
    "upgrade",
    "upload",
    "use",
    "validate",
    "verify",
    "watch",
    "write",
]);

function isImperativeStart(desc: string): string | null {
    const firstWord = desc
        .split(/\s/)[0]
        .toLowerCase()
        .replace(/[.,;:!?]$/, "");

    // Negative pattern: first person
    if (/^(I|We)\s/i.test(desc)) return firstWord;

    // Negative pattern: second person
    if (/^You\s/i.test(desc)) return firstWord;

    // Verb dictionary: bare imperative (no trailing "s")
    if (IMPERATIVE_VERBS.has(firstWord)) return firstWord;

    return null;
}

function lintSkillDescription(
    prefix: string,
    desc: string,
    raw: string,
    file: string,
    maxDescChars: number,
): LintResult[] {
    const results: LintResult[] = [];

    if (desc.length > maxDescChars) {
        results.push({
            rule: "skill/description-length",
            severity: "error",
            message: `${prefix}: description exceeds ${maxDescChars} chars (${desc.length})`,
            file,
        });
    }

    const imperativeWord = isImperativeStart(desc);
    if (imperativeWord) {
        results.push({
            rule: "skill/description-third-person",
            severity: "warning",
            message: `${prefix}: description should use third person ("Generates…", "Validates…")`,
            file,
            detail: `Starts with imperative/non-third-person: "${desc.slice(0, 60)}…"`,
        });
    }

    if (!desc.includes('"') && !desc.includes("'") && !desc.includes("ask")) {
        results.push({
            rule: "skill/description-has-triggers",
            severity: "warning",
            message: `${prefix}: description should include specific trigger phrases`,
            file,
            detail: 'Include quoted phrases like "create X", "configure Y"',
        });
    }

    if (/<[^>]{1,200}>/.test(raw)) {
        results.push({
            rule: "skill/no-xml-in-frontmatter",
            severity: "error",
            message: `${prefix}: frontmatter contains XML-like brackets`,
            file,
        });
    }

    return results;
}

function lintSingleSkill(
    skillName: string,
    skillDir: string,
    skillMdPath: string,
    maxDescChars: number,
): LintResult[] {
    const results: LintResult[] = [];
    const prefix = `skill/${skillName}`;

    // SKILL.md exists with exact casing
    if (!fileExists(skillMdPath)) {
        results.push({
            rule: "skill/has-skill-md",
            severity: "error",
            message: `${prefix}: missing SKILL.md`,
            file: skillDir,
        });
        return results;
    }

    // Case-sensitive check: on case-insensitive filesystems (macOS),
    // "skill.md" or "SKILL.MD" would pass fileExists but is wrong
    const actualFiles = listDir(skillDir);
    const skillVariant = actualFiles.find((f) => f.toLowerCase() === "skill.md");
    if (skillVariant && skillVariant !== "SKILL.md") {
        results.push({
            rule: "skill/skill-md-casing",
            severity: "error",
            message: `${prefix}: found '${skillVariant}' — must be exactly 'SKILL.md'`,
            file: join(skillDir, skillVariant),
        });
        return results;
    }

    // Kebab-case folder name
    if (!isKebabCase(skillName)) {
        results.push({
            rule: "skill/kebab-case",
            severity: "error",
            message: `${prefix}: folder name must be kebab-case`,
            file: skillDir,
        });
    }

    // No README.md in skill folder
    if (fileExists(join(skillDir, "README.md"))) {
        results.push({
            rule: "skill/no-readme",
            severity: "error",
            message: `${prefix}: README.md should not be in skill folder (use SKILL.md)`,
            file: join(skillDir, "README.md"),
        });
    }

    // Reserved names
    if (RESERVED_NAMES.has(skillName)) {
        results.push({
            rule: "skill/no-reserved-name",
            severity: "error",
            message: `${prefix}: "${skillName}" is a reserved name`,
            file: skillDir,
        });
    }

    // Empty references/
    const refsDir = join(skillDir, "references");
    if (isDir(refsDir) && listFiles(refsDir).length === 0) {
        results.push({
            rule: "skill/no-empty-references",
            severity: "error",
            message: `${prefix}: references/ directory is empty`,
            file: refsDir,
        });
    }

    // Parse frontmatter
    const content = readFile(skillMdPath);
    const fm = parseFrontmatter(content);
    if (!fm) {
        results.push({
            rule: "skill/valid-frontmatter",
            severity: "error",
            message: `${prefix}: missing or invalid YAML frontmatter`,
            file: skillMdPath,
        });
        return results;
    }

    // Name field
    if (!fm.fields.name) {
        results.push({
            rule: "skill/has-name",
            severity: "error",
            message: `${prefix}: frontmatter missing 'name' field`,
            file: skillMdPath,
        });
    } else {
        if (fm.fields.name !== skillName) {
            results.push({
                rule: "skill/name-matches-folder",
                severity: "error",
                message: `${prefix}: name "${fm.fields.name}" doesn't match folder "${skillName}"`,
                file: skillMdPath,
            });
        }
        if (!isKebabCase(fm.fields.name)) {
            results.push({
                rule: "skill/name-kebab-case",
                severity: "error",
                message: `${prefix}: name must be kebab-case`,
                file: skillMdPath,
            });
        }
    }

    // Description field
    if (!fm.fields.description) {
        results.push({
            rule: "skill/has-description",
            severity: "error",
            message: `${prefix}: frontmatter missing 'description' field`,
            file: skillMdPath,
        });
    } else {
        results.push(
            ...lintSkillDescription(
                prefix,
                fm.fields.description,
                fm.raw,
                skillMdPath,
                maxDescChars,
            ),
        );
    }

    // Body word count
    if (fm.bodyWordCount > MAX_BODY_WORDS) {
        results.push({
            rule: "skill/body-length",
            severity: "warning",
            message: `${prefix}: body exceeds ${MAX_BODY_WORDS} words (${fm.bodyWordCount})`,
            file: skillMdPath,
            detail: "Consider moving detailed content to references/",
        });
    }

    // License / metadata (warnings)
    if (!fm.fields.license) {
        results.push({
            rule: "skill/has-license",
            severity: "warning",
            message: `${prefix}: missing 'license' field in frontmatter`,
            file: skillMdPath,
        });
    }

    return results;
}

export function lintSkills(pluginDir: string, maxDescChars?: number): LintResult[] {
    const results: LintResult[] = [];
    const skillsDir = join(pluginDir, "skills");
    const limit = maxDescChars ?? DEFAULT_MAX_DESC_CHARS;

    if (!isDir(skillsDir)) {
        return results;
    }

    const skillDirs = listDir(skillsDir).filter((d) => isDir(join(skillsDir, d)));

    for (const skillName of skillDirs) {
        const skillDir = join(skillsDir, skillName);
        const skillMdPath = join(skillDir, "SKILL.md");
        results.push(...lintSingleSkill(skillName, skillDir, skillMdPath, limit));
    }

    return results;
}
