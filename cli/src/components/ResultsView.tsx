import React from "react";
import { Box, Text } from "ink";
import { C } from "../theme.js";
import { DIVIDER } from "../verdicts.js";
import { ScrollableView } from "./ScrollableView.js";
import type { StructuralResult, IntegrationResult, ComponentType } from "../types.js";

interface ResultsViewProps {
    structural: StructuralResult[];
    integration: IntegrationResult[];
    visibleHeight: number;
    scrollOffset: number;
}

interface ResultLine {
    text: string;
    color?: string;
    bold?: boolean;
    indent?: number;
}

function componentTag(comp?: string): string {
    return comp && comp !== "unknown" ? `[${comp}] ` : "";
}

function inferIntComponentType(r: IntegrationResult): ComponentType {
    if (r.type === "command") return "command";
    if (r.type === "hook") return "hook";
    if (r.type === "agent" || r.name.startsWith("agent:")) return "agent";
    return "skill";
}

function buildVerdictSection(
    icon: string,
    label: string,
    color: string,
    items: Array<{ text: string; detail?: string; extra?: string }>,
    indent: number,
): ResultLine[] {
    if (items.length === 0) return [];

    const lines: ResultLine[] = [];
    lines.push({
        text: `${icon} ${label} (${items.length})`,
        color,
        bold: true,
        indent: indent,
    });
    lines.push({ text: "" });

    for (const item of items) {
        lines.push({
            text: `${icon} ${item.text}`,
            color,
            indent: indent + 1,
        });
        if (item.detail) {
            lines.push({ text: `  ↳ ${item.detail}`, color: C.dimText, indent: indent + 1 });
        }
        if (item.extra) {
            lines.push({ text: item.extra, color: C.dim, indent: indent + 1 });
        }
    }
    lines.push({ text: "" });

    return lines;
}

export function buildResultLines(
    structural: StructuralResult[],
    integration: IntegrationResult[],
): ResultLine[] {
    const lines: ResultLine[] = [];

    const skippedStruct = structural.filter((r) => r.verdict === "skip");
    const skippedInt = integration.filter((r) => r.verdict === "skip");
    const warnedStruct = structural.filter((r) => r.verdict === "warn");
    const warnedInt = integration.filter((r) => r.verdict === "warn");
    const failedStruct = structural.filter((r) => r.verdict === "fail");
    const failedInt = integration.filter((r) => r.verdict === "fail" || r.verdict === "error");

    const hasSkips = skippedStruct.length + skippedInt.length > 0;
    const hasWarnings = warnedStruct.length + warnedInt.length > 0;
    const hasFailures = failedStruct.length + failedInt.length > 0;

    if (!hasSkips && !hasWarnings && !hasFailures) {
        const total = structural.length + integration.length;
        lines.push({ text: "" });
        lines.push({ text: "✔ All clear", color: C.green, bold: true, indent: 2 });
        lines.push({ text: `All ${total} tests passed`, color: C.dimText, indent: 2 });
        return lines;
    }

    // Failures first (most important)
    lines.push(
        ...buildVerdictSection(
            "✘",
            "Structural Failures",
            C.red,
            failedStruct.map((r) => ({
                text: `${componentTag(r.component)}${r.label}`,
                detail: r.detail,
            })),
            1,
        ),
    );

    lines.push(
        ...buildVerdictSection(
            "✘",
            "Integration Failures",
            C.red,
            failedInt.map((r) => ({
                text: `${componentTag(inferIntComponentType(r))}${r.testId}  [${r.verdict === "error" ? "ERR" : "FAIL"}]`,
                detail: r.detail,
                extra: r.trigger ? `  trigger: "${r.trigger}"` : undefined,
            })),
            1,
        ),
    );

    // Divider between failures and warnings
    if (hasFailures && (hasWarnings || hasSkips)) {
        lines.push({
            text: DIVIDER,
            color: C.dim,
            indent: 1,
        });
        lines.push({ text: "" });
    }

    // Warnings
    lines.push(
        ...buildVerdictSection(
            "!",
            "Structural Warnings",
            C.yellow,
            warnedStruct.map((r) => ({
                text: `${componentTag(r.component)}${r.label}`,
                detail: r.detail,
            })),
            1,
        ),
    );

    lines.push(
        ...buildVerdictSection(
            "!",
            "Integration Warnings",
            C.yellow,
            warnedInt.map((r) => {
                const loadedMatch = /loaded:\s*(\S+)\s*\(expected:\s*(\S+)\)/.exec(r.detail);
                const detail = loadedMatch
                    ? `loaded: ${loadedMatch[1]} → expected: ${loadedMatch[2]}`
                    : r.detail;
                return {
                    text: `${componentTag(inferIntComponentType(r))}${r.testId}`,
                    detail,
                    extra: r.trigger ? `  trigger: "${r.trigger}"` : undefined,
                };
            }),
            1,
        ),
    );

    // Divider between warnings and skips
    if (hasWarnings && hasSkips) {
        lines.push({
            text: DIVIDER,
            color: C.dim,
            indent: 1,
        });
        lines.push({ text: "" });
    }

    // Skipped last
    lines.push(
        ...buildVerdictSection(
            "⊘",
            "Structural Skipped",
            C.dimText,
            skippedStruct.map((r) => ({
                text: `${componentTag(r.component)}${r.label}`,
                detail: r.detail,
            })),
            1,
        ),
    );

    lines.push(
        ...buildVerdictSection(
            "⊘",
            "Integration Skipped",
            C.dimText,
            skippedInt.map((r) => ({
                text: `${componentTag(inferIntComponentType(r))}${r.testId}`,
                detail: r.detail,
            })),
            1,
        ),
    );

    return lines;
}

export function ResultsView({
    structural,
    integration,
    visibleHeight,
    scrollOffset,
}: Readonly<ResultsViewProps>) {
    const lines = buildResultLines(structural, integration);
    const visibleLines = lines.slice(scrollOffset, scrollOffset + visibleHeight);

    return (
        <ScrollableView
            lineCount={lines.length}
            visibleHeight={visibleHeight}
            scrollOffset={scrollOffset}
            paddingTop={1}
        >
            {visibleLines.map((line, i) => (
                <Box key={scrollOffset + i} paddingLeft={line.indent ?? 0}>
                    <Text color={line.color} bold={line.bold}>
                        {line.text}
                    </Text>
                </Box>
            ))}
        </ScrollableView>
    );
}
