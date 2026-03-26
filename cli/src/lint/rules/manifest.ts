import { join, basename } from "node:path";
import { fileExists, readFile, parseJson } from "../utils.js";
import type { LintResult } from "../types.js";

export function lintManifest(pluginDir: string): LintResult[] {
    const results: LintResult[] = [];
    const manifestDir = join(pluginDir, ".claude-plugin");
    const manifestPath = join(manifestDir, "plugin.json");
    const dirName = basename(pluginDir);

    if (!fileExists(manifestDir)) {
        results.push({
            rule: "manifest/exists",
            severity: "info",
            message: `No .claude-plugin/ directory — validating components only`,
        });
        return results;
    }

    if (!fileExists(manifestPath)) {
        results.push({
            rule: "manifest/exists",
            severity: "error",
            message: "Missing plugin.json inside .claude-plugin/",
            file: manifestPath,
        });
        return results;
    }

    const content = readFile(manifestPath);
    const parsed = parseJson(content);
    if (!parsed.ok) {
        results.push({
            rule: "manifest/valid-json",
            severity: "error",
            message: "plugin.json is not valid JSON",
            file: manifestPath,
            detail: parsed.error,
        });
        return results;
    }

    const data = parsed.data as Record<string, unknown>;

    // Name
    if (!data.name || typeof data.name !== "string") {
        results.push({
            rule: "manifest/has-name",
            severity: "error",
            message: "plugin.json missing 'name' field",
            file: manifestPath,
        });
    } else if (data.name !== dirName) {
        results.push({
            rule: "manifest/name-matches-folder",
            severity: "error",
            message: `plugin.json name "${data.name}" doesn't match folder "${dirName}"`,
            file: manifestPath,
        });
    }

    // Description
    if (!data.description || typeof data.description !== "string") {
        results.push({
            rule: "manifest/has-description",
            severity: "error",
            message: "plugin.json missing 'description' field",
            file: manifestPath,
        });
    }

    // Version (warning only)
    if (!data.version) {
        results.push({
            rule: "manifest/has-version",
            severity: "warning",
            message: "plugin.json missing 'version' field",
            file: manifestPath,
        });
    }

    return results;
}
