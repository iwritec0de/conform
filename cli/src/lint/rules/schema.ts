import { join } from "node:path";
import { createRequire } from "node:module";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { fileExists, readFile, parseJson } from "../utils.js";
import type { LintResult } from "../types.js";

const require = createRequire(import.meta.url);

const pluginSchema: unknown = require("../schemas/plugin.schema.json");
const marketplaceSchema: unknown = require("../schemas/marketplace.schema.json");

const ajv = new Ajv2020({ allErrors: true, strict: false });
(formatsPlugin as unknown as (ajv: Ajv2020) => void)(ajv);

const pluginValidate = ajv.compile(pluginSchema as Record<string, unknown>);
const marketplaceValidate = ajv.compile(marketplaceSchema as Record<string, unknown>);

function formatError(err: ErrorObject): string {
    const path = err.instancePath || "(root)";
    const msg = err.message ?? "unknown error";

    if (err.params?.additionalProperty) {
        return `${path}: unknown property '${String(err.params.additionalProperty)}'`;
    }
    if (err.params?.pattern) {
        return `${path}: ${msg} (pattern: ${String(err.params.pattern)})`;
    }

    return `${path}: ${msg}`;
}

/**
 * Validate plugin.json against the JSON Schema.
 */
export function lintPluginSchema(pluginDir: string): LintResult[] {
    const results: LintResult[] = [];
    const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");

    if (!fileExists(manifestPath)) return results;

    const content = readFile(manifestPath);
    const parsed = parseJson(content);
    if (!parsed.ok) return results; // JSON parse errors handled by manifest rule

    const valid = pluginValidate(parsed.data);

    if (!valid && pluginValidate.errors) {
        for (const err of pluginValidate.errors) {
            results.push({
                rule: "schema/plugin-json",
                severity: "error",
                message: `plugin.json schema violation: ${formatError(err)}`,
                file: manifestPath,
                detail: JSON.stringify(err, null, 2),
            });
        }
    } else {
        results.push({
            rule: "schema/plugin-json",
            severity: "info",
            message: "plugin.json passes schema validation",
            file: manifestPath,
        });
    }

    return results;
}

/**
 * Validate marketplace.json against the JSON Schema.
 */
export function lintMarketplaceSchema(pluginDir: string): LintResult[] {
    const results: LintResult[] = [];
    const marketplacePath = join(pluginDir, ".claude-plugin", "marketplace.json");

    if (!fileExists(marketplacePath)) return results;

    const content = readFile(marketplacePath);
    const parsed = parseJson(content);
    if (!parsed.ok) {
        results.push({
            rule: "schema/marketplace-json",
            severity: "error",
            message: "marketplace.json is not valid JSON",
            file: marketplacePath,
            detail: parsed.error,
        });
        return results;
    }

    const valid = marketplaceValidate(parsed.data);

    if (!valid && marketplaceValidate.errors) {
        for (const err of marketplaceValidate.errors) {
            results.push({
                rule: "schema/marketplace-json",
                severity: "error",
                message: `marketplace.json schema violation: ${formatError(err)}`,
                file: marketplacePath,
                detail: JSON.stringify(err, null, 2),
            });
        }
    } else {
        results.push({
            rule: "schema/marketplace-json",
            severity: "info",
            message: "marketplace.json passes schema validation",
            file: marketplacePath,
        });
    }

    return results;
}
