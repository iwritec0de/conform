import { C } from "./theme.js";
import type { StructuralResult, IntegrationResult } from "./types.js";

// ── Shared icon/color maps ─────────────────────────────────────────

export const VERDICT_ICONS: Record<string, { icon: string; color: string }> = {
    pass: { icon: "✔", color: C.green },
    fail: { icon: "✘", color: C.red },
    warn: { icon: "!", color: C.yellow },
    error: { icon: "✘", color: C.red },
    skip: { icon: "⊘", color: C.dimText },
};

export const DIVIDER = "───────────────────────────────────────────────";

// ── Verdict counting ───────────────────────────────────────────────

export interface VerdictCounts {
    passed: number;
    failed: number;
    warned: number;
    skipped: number;
    total: number;
}

export function countStructVerdicts(results: StructuralResult[]): VerdictCounts {
    let passed = 0,
        failed = 0,
        warned = 0,
        skipped = 0;
    for (const r of results) {
        if (r.verdict === "pass") passed++;
        else if (r.verdict === "fail") failed++;
        else if (r.verdict === "warn") warned++;
        else if (r.verdict === "skip") skipped++;
    }
    return { passed, failed, warned, skipped, total: results.length };
}

export function countIntVerdicts(results: IntegrationResult[]): VerdictCounts {
    let passed = 0,
        failed = 0,
        warned = 0,
        skipped = 0;
    for (const r of results) {
        if (r.verdict === "pass") passed++;
        else if (r.verdict === "fail" || r.verdict === "error") failed++;
        else if (r.verdict === "warn") warned++;
        else if (r.verdict === "skip") skipped++;
    }
    return { passed, failed, warned, skipped, total: results.length };
}

// ── Summary text builder ───────────────────────────────────────────

export function buildSummaryText(counts: VerdictCounts, options?: { showTotal?: boolean }): string {
    const { passed, failed, warned, skipped, total } = counts;
    let text = `✔ ${passed} passed`;
    if (failed > 0) text += `  ✘ ${failed} failed`;
    if (warned > 0) text += `  ! ${warned} warnings`;
    if (skipped > 0) text += `  ⊘ ${skipped} skipped`;
    if (options?.showTotal) text += ` (${total} tests)`;
    return text;
}

export interface SummarySegment {
    text: string;
    color?: string;
}

export function buildSummarySegments(
    counts: VerdictCounts,
    options?: { showTotal?: boolean },
): SummarySegment[] {
    const { passed, failed, warned, skipped, total } = counts;
    const segments: SummarySegment[] = [{ text: `✔ ${passed} passed`, color: C.green }];
    if (failed > 0) segments.push({ text: `✘ ${failed} failed`, color: C.red });
    if (warned > 0) segments.push({ text: `! ${warned} warnings`, color: C.yellow });
    if (skipped > 0) segments.push({ text: `⊘ ${skipped} skipped`, color: C.dimText });
    if (options?.showTotal) segments.push({ text: `(${total} tests)`, color: C.dimText });
    return segments;
}
