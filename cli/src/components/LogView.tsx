import React from "react";
import { Box, Text } from "ink";
import { SlowSpinner } from "./SlowSpinner.js";
import { ScrollableView } from "./ScrollableView.js";
import { C } from "../theme.js";
import {
    VERDICT_ICONS,
    DIVIDER,
    countStructVerdicts,
    countIntVerdicts,
    buildSummaryText,
} from "../verdicts.js";
import type { StructuralResult, IntegrationResult, Phase, ComponentType } from "../types.js";

const COMPONENT_TAG_COLOR: Record<ComponentType, string> = {
    manifest: C.dimText,
    skill: C.cyan,
    command: C.magenta,
    agent: C.purple,
    hook: C.yellow,
    unknown: C.dimText,
};

function componentTag(
    comp: ComponentType,
): { tag: string; tagColor: string } | Record<string, never> {
    if (!comp || comp === "unknown") return {};
    return { tag: `[${comp}]`, tagColor: COMPONENT_TAG_COLOR[comp] };
}

function inferIntComponentType(r: IntegrationResult): ComponentType {
    if (r.type === "command") return "command";
    if (r.type === "hook") return "hook";
    if (r.type === "agent" || r.name.startsWith("agent:")) return "agent";
    return "skill";
}

interface TextSegment {
    text: string;
    color?: string;
}

interface LogLine {
    type: "section" | "result" | "detail" | "summary" | "divider" | "spinner";
    text: string;
    color?: string;
    icon?: string;
    iconColor?: string;
    bold?: boolean;
    tag?: string;
    tagColor?: string;
    segments?: TextSegment[];
}

interface LogViewProps {
    phase: Phase;
    structResults: StructuralResult[];
    intResults: IntegrationResult[];
    intTotal: number;
    structSection: string;
    structRunning: boolean;
    intRunning: boolean;
    activeTest: string | null;
    activeTrigger: string | null;
    visibleHeight: number;
    scrollOffset: number;
}

function buildStructuralLogLines(
    structResults: StructuralResult[],
    structRunning: boolean,
    structSection: string,
): LogLine[] {
    if (structResults.length === 0 && !structRunning) return [];

    const lines: LogLine[] = [];

    lines.push({
        type: "section",
        text: `▸ Structural Tests (${structResults.length} tests)`,
        color: C.purple,
        bold: true,
    });

    const visible = structResults;

    for (const r of visible) {
        const v = VERDICT_ICONS[r.verdict] || VERDICT_ICONS.pass;
        lines.push({
            type: "result",
            text: r.label,
            icon: v.icon,
            iconColor: v.color,
            ...componentTag(r.component),
        });
        if (r.detail) {
            lines.push({
                type: "detail",
                text: `↳ ${r.detail}`,
                color: v.color,
            });
        }
    }

    if (structRunning) {
        lines.push({
            type: "spinner",
            text: `Structural: ${structSection} (${structResults.length} done)`,
            color: C.dimText,
        });
    } else {
        const counts = countStructVerdicts(structResults);
        lines.push({
            type: "summary",
            text: buildSummaryText(counts),
            color: counts.failed > 0 ? C.red : C.green,
        });
        lines.push({ type: "divider", text: "" });
    }

    return lines;
}

function buildIntegrationLogLines(
    intResults: IntegrationResult[],
    intTotal: number,
    intRunning: boolean,
    activeTest: string | null,
    activeTrigger: string | null,
): LogLine[] {
    if (intResults.length === 0 && intTotal === 0 && !intRunning) return [];

    const lines: LogLine[] = [];
    const total = Math.max(intTotal, intResults.length);

    lines.push({
        type: "section",
        text: `▸ Integration Tests${total > 0 ? ` (${intResults.length}/${total})` : ""}`,
        color: C.purple,
        bold: true,
    });

    for (let i = 0; i < intResults.length; i++) {
        const r = intResults[i];
        const v = VERDICT_ICONS[r.verdict] || VERDICT_ICONS.pass;
        const progress = total > 0 ? `[${i + 1}/${total}]` : `[${i + 1}]`;
        const triggerSuffix = r.trigger ? ` "${r.trigger}"` : "";
        lines.push({
            type: "result",
            text: `${progress} ${r.testId}${triggerSuffix}`,
            icon: v.icon,
            iconColor: v.color,
            ...componentTag(inferIntComponentType(r)),
        });
        if (r.detail && (r.verdict === "fail" || r.verdict === "error" || r.verdict === "warn")) {
            // Format wrong-skill warns more clearly
            const loadedMatch = /loaded:\s*(\S+)\s*\(expected:\s*(\S+)\)/.exec(r.detail);
            if (loadedMatch) {
                lines.push({
                    type: "detail",
                    text: "",
                    segments: [
                        { text: "↳ loaded: ", color: C.dimText },
                        { text: loadedMatch[1], color: C.white },
                        { text: " → expected: ", color: C.dimText },
                        { text: loadedMatch[2], color: C.purple },
                    ],
                });
            } else {
                lines.push({
                    type: "detail",
                    text: `↳ ${r.detail}`,
                    color: v.color,
                });
            }
        }
    }

    if (intRunning) {
        let spinnerText = "waiting…";
        if (activeTest) {
            spinnerText = activeTrigger ? `${activeTest} → "${activeTrigger}"` : activeTest;
        }
        lines.push({
            type: "spinner",
            text: spinnerText,
            color: C.dimText,
        });
    } else if (intResults.length > 0) {
        const counts = countIntVerdicts(intResults);
        lines.push({
            type: "summary",
            text: buildSummaryText(counts),
            color: counts.failed > 0 ? C.red : C.green,
        });
    }

    return lines;
}

function buildLogLines(
    phase: Phase,
    structResults: StructuralResult[],
    intResults: IntegrationResult[],
    intTotal: number,
    structRunning: boolean,
    intRunning: boolean,
    structSection: string,
    activeTest: string | null,
    activeTrigger: string | null,
): LogLine[] {
    return [
        ...buildStructuralLogLines(structResults, structRunning, structSection),
        ...buildIntegrationLogLines(intResults, intTotal, intRunning, activeTest, activeTrigger),
    ];
}

const LogLineRow = React.memo(function LogLineRow({ line }: { line: LogLine }) {
    if (line.type === "divider") {
        return (
            <Box paddingLeft={1}>
                <Text color={C.dim}>{DIVIDER}</Text>
            </Box>
        );
    }

    if (line.type === "section") {
        return (
            <Box paddingLeft={1}>
                <Text color={line.color} bold={line.bold}>
                    {line.text}
                </Text>
            </Box>
        );
    }

    if (line.type === "detail") {
        if (line.segments) {
            return (
                <Box paddingLeft={4} gap={0}>
                    {line.segments.map((s, i) => (
                        <Text key={i} color={s.color}>
                            {s.text}
                        </Text>
                    ))}
                </Box>
            );
        }
        return (
            <Box paddingLeft={4}>
                <Text color={line.color}>{line.text}</Text>
            </Box>
        );
    }

    if (line.type === "summary") {
        return (
            <Box paddingLeft={2}>
                <Text color={line.color}>{line.text}</Text>
            </Box>
        );
    }

    if (line.type === "spinner") {
        return (
            <Box paddingLeft={2} gap={1}>
                <SlowSpinner />
                <Text color={line.color}>{line.text}</Text>
            </Box>
        );
    }

    // result line — text inherits the verdict color
    const textColor = line.iconColor ?? C.white;
    return (
        <Box paddingLeft={2} gap={1}>
            <Text color={line.iconColor}>{line.icon}</Text>
            {line.tag && <Text color={line.tagColor ?? C.dimText}>{line.tag}</Text>}
            <Text color={textColor}>{line.text}</Text>
        </Box>
    );
});

export function LogView({
    phase,
    structResults,
    intResults,
    intTotal,
    structSection,
    structRunning,
    intRunning,
    activeTest,
    activeTrigger,
    visibleHeight,
    scrollOffset,
}: Readonly<LogViewProps>) {
    const lines = buildLogLines(
        phase,
        structResults,
        intResults,
        intTotal,
        structRunning,
        intRunning,
        structSection,
        activeTest,
        activeTrigger,
    );

    const visibleLines = lines.slice(scrollOffset, scrollOffset + visibleHeight);

    return (
        <ScrollableView
            lineCount={lines.length}
            visibleHeight={visibleHeight}
            scrollOffset={scrollOffset}
        >
            {visibleLines.map((line, i) => (
                <LogLineRow key={scrollOffset + i} line={line} />
            ))}
        </ScrollableView>
    );
}
