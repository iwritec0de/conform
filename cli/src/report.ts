import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { countStructVerdicts, countIntVerdicts, buildSummaryText } from "./verdicts.js";
import { buildHtmlReport } from "./report-html.js";
import type {
    CliOptions,
    StructuralResult,
    IntegrationResult,
    ResponseLogResult,
    TokenUsage,
    ComponentType,
} from "./types.js";

function inferIntComponentType(r: IntegrationResult): ComponentType {
    if (r.type === "command") return "command";
    if (r.type === "hook") return "hook";
    if (r.type === "agent" || r.name.startsWith("agent:")) return "agent";
    return "skill";
}

function typeLabel(comp: ComponentType): string {
    return comp && comp !== "unknown" ? comp : "";
}

function timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function verdictEmoji(verdict: string): string {
    switch (verdict) {
        case "pass":
            return "✅";
        case "fail":
            return "❌";
        case "error":
            return "❌";
        case "warn":
            return "⚠️";
        case "skip":
            return "⏭️";
        default:
            return "❓";
    }
}

function buildReportHeader(
    opts: CliOptions,
    sc: ReturnType<typeof countStructVerdicts>,
    ic: ReturnType<typeof countIntVerdicts>,
): string[] {
    const totalPassed = sc.passed + ic.passed;
    const totalFailed = sc.failed + ic.failed;
    const totalWarns = sc.warned + ic.warned;
    const totalSkipped = sc.skipped + ic.skipped;
    const totalTests = sc.total + ic.total;
    const passRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : "0.0";
    const overallResult = totalFailed === 0 ? "PASS" : "FAIL";

    return [
        `# Claude Test Suite Report`,
        ``,
        `**Date:** ${new Date().toISOString()}`,
        `**Target:** \`${resolve(process.cwd(), opts.target)}\``,
        `**Mode:** ${opts.mode}`,
        `**Model:** ${opts.model}`,
        `**Result:** ${overallResult === "PASS" ? "✅ PASS" : "❌ FAIL"}`,
        ``,
        `## Summary`,
        ``,
        `| Metric | Value |`,
        `|--------|-------|`,
        `| Total tests | ${totalTests} |`,
        `| Passed | ${totalPassed} |`,
        `| Failed | ${totalFailed} |`,
        `| Warnings | ${totalWarns} |`,
        `| Skipped | ${totalSkipped} |`,
        `| Pass rate | ${passRate}% |`,
        ``,
    ];
}

function buildStructuralTable(
    structResults: StructuralResult[],
    sc: ReturnType<typeof countStructVerdicts>,
): string[] {
    if (structResults.length === 0) return [];

    const lines: string[] = [
        `## Structural Tests`,
        ``,
        `${buildSummaryText(sc, { showTotal: true })}`,
        ``,
        `| # | Verdict | Type | Test | Detail |`,
        `|---|---------|------|------|--------|`,
    ];
    for (const r of structResults) {
        const detail = r.detail ? r.detail.replace(/\|/g, "\\|") : "";
        lines.push(
            `| ${r.id} | ${verdictEmoji(r.verdict)} ${r.verdict} | ${typeLabel(r.component)} | ${r.label} | ${detail} |`,
        );
    }
    lines.push(``);
    return lines;
}

function buildIntegrationTable(
    intResults: IntegrationResult[],
    ic: ReturnType<typeof countIntVerdicts>,
): string[] {
    if (intResults.length === 0) return [];

    const lines: string[] = [
        `## Integration Tests`,
        ``,
        `${buildSummaryText(ic, { showTotal: true })}`,
        ``,
        `| # | Verdict | Type | Test | Trigger | Detail | Cost |`,
        `|---|---------|------|------|---------|--------|------|`,
    ];
    for (let i = 0; i < intResults.length; i++) {
        const r = intResults[i];
        const detail = r.detail ? r.detail.replace(/\|/g, "\\|") : "";
        const trigger = r.trigger ? `\`${r.trigger.replace(/\|/g, "\\|")}\`` : "";
        const cost = r.costUsd > 0 ? `$${r.costUsd.toFixed(4)}` : "";
        lines.push(
            `| ${i + 1} | ${verdictEmoji(r.verdict)} ${r.verdict} | ${typeLabel(inferIntComponentType(r))} | ${r.testId} | ${trigger} | ${detail} | ${cost} |`,
        );
    }
    lines.push(``);

    // Token usage
    const totalCost = intResults.reduce((sum, r) => sum + (r.costUsd || 0), 0);
    const hasTokens = intResults.some((r) => r.tokens !== null);
    if (hasTokens) {
        const tokens: TokenUsage = {
            inputTokens: intResults.reduce((sum, r) => sum + (r.tokens?.inputTokens ?? 0), 0),
            outputTokens: intResults.reduce((sum, r) => sum + (r.tokens?.outputTokens ?? 0), 0),
            cacheReadInputTokens: intResults.reduce(
                (sum, r) => sum + (r.tokens?.cacheReadInputTokens ?? 0),
                0,
            ),
            cacheCreationInputTokens: intResults.reduce(
                (sum, r) => sum + (r.tokens?.cacheCreationInputTokens ?? 0),
                0,
            ),
        };
        lines.push(`### Token Usage`);
        lines.push(``);
        lines.push(`| Metric | Value |`);
        lines.push(`|--------|-------|`);
        lines.push(`| Total cost | $${totalCost.toFixed(4)} |`);
        lines.push(`| Input tokens | ${tokens.inputTokens.toLocaleString()} |`);
        lines.push(`| Output tokens | ${tokens.outputTokens.toLocaleString()} |`);
        lines.push(`| Cache read | ${tokens.cacheReadInputTokens.toLocaleString()} |`);
        lines.push(`| Cache write | ${tokens.cacheCreationInputTokens.toLocaleString()} |`);
        lines.push(``);
    }

    return lines;
}

function buildFailuresSection(
    structResults: StructuralResult[],
    intResults: IntegrationResult[],
): string[] {
    const failedStruct = structResults.filter((r) => r.verdict === "fail");
    const failedInt = intResults.filter((r) => r.verdict === "fail" || r.verdict === "error");
    if (failedStruct.length + failedInt.length === 0) return [];

    const lines: string[] = [`## Failures`, ``];
    for (const r of failedStruct) {
        const tag = typeLabel(r.component);
        const prefix = tag ? `[${tag}] ` : "";
        lines.push(`- **${prefix}${r.label}**: ${r.detail || "no detail"}`);
    }
    for (const r of failedInt) {
        const label = r.verdict === "error" ? "ERR" : "FAIL";
        const tag = typeLabel(inferIntComponentType(r));
        const prefix = tag ? `[${tag}] ` : "";
        lines.push(
            `- **${prefix}${r.testId}** [${label}]: ${r.detail || "no detail"}${r.trigger ? ` (trigger: "${r.trigger}")` : ""}`,
        );
    }
    lines.push(``);
    return lines;
}

function writeMdReport(
    opts: CliOptions,
    structResults: StructuralResult[],
    intResults: IntegrationResult[],
): string {
    const sc = countStructVerdicts(structResults);
    const ic = countIntVerdicts(intResults);

    const lines: string[] = [
        ...buildReportHeader(opts, sc, ic),
        ...buildStructuralTable(structResults, sc),
        ...buildIntegrationTable(intResults, ic),
        ...buildFailuresSection(structResults, intResults),
        `---`,
        `*Generated by Claude Test Suite*`,
    ];

    return lines.join("\n");
}

export function writeReport(
    opts: CliOptions,
    structResults: StructuralResult[],
    intResults: IntegrationResult[],
    rlResults: ResponseLogResult[] = [],
    elapsed?: number,
): string {
    const dir = resolve(process.cwd(), opts.reportDir);
    mkdirSync(dir, { recursive: true });

    const targetName = basename(resolve(process.cwd(), opts.target));
    const ts = timestamp();
    let content: string;
    let ext: string;

    switch (opts.reportType) {
        case "html":
            content = buildHtmlReport(opts, structResults, intResults, rlResults, elapsed);
            ext = "html";
            break;
        case "json":
            content = JSON.stringify(
                {
                    meta: {
                        date: new Date().toISOString(),
                        target: resolve(process.cwd(), opts.target),
                        mode: opts.mode,
                        model: opts.model,
                        elapsed,
                    },
                    structural: structResults,
                    integration: intResults,
                    responseLog: rlResults,
                },
                null,
                2,
            );
            ext = "json";
            break;
        case "md":
        default:
            content = writeMdReport(opts, structResults, intResults);
            ext = "md";
            break;
    }

    const filename = `report-${targetName}-${ts}.${ext}`;
    const filepath = resolve(dir, filename);
    writeFileSync(filepath, content, "utf-8");
    return filepath;
}
