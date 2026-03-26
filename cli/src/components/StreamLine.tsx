import React from "react";
import { Box, Text } from "ink";
import { C } from "../theme.js";
import { DIVIDER } from "../verdicts.js";

export interface TextSegment {
    text: string;
    color?: string;
}

export interface StreamItem {
    id: string;
    type: "section" | "result" | "detail" | "summary" | "divider";
    text: string;
    color?: string;
    icon?: string;
    iconColor?: string;
    bold?: boolean;
    tag?: string;
    tagColor?: string;
    segments?: TextSegment[];
}

export function StreamLine({ item }: Readonly<{ item: StreamItem }>) {
    if (item.type === "divider") {
        return (
            <Box paddingLeft={1}>
                <Text color={C.dim}>{DIVIDER}</Text>
            </Box>
        );
    }

    if (item.type === "section") {
        return (
            <Box paddingLeft={1}>
                <Text color={item.color} bold={item.bold}>
                    {item.text}
                </Text>
            </Box>
        );
    }

    if (item.type === "detail") {
        return (
            <Box paddingLeft={4}>
                <Text color={item.color}>{item.text}</Text>
            </Box>
        );
    }

    if (item.type === "summary") {
        if (item.segments && item.segments.length > 0) {
            return (
                <Box paddingLeft={2} gap={1}>
                    {item.segments.map((seg, i) => (
                        <Text key={i} color={seg.color}>
                            {seg.text}
                        </Text>
                    ))}
                </Box>
            );
        }
        return (
            <Box paddingLeft={2}>
                <Text color={item.color}>{item.text}</Text>
            </Box>
        );
    }

    // result line — text inherits the verdict color
    const textColor = item.iconColor ?? C.white;
    return (
        <Box paddingLeft={2} gap={1}>
            <Text color={item.iconColor}>{item.icon}</Text>
            {item.tag && <Text color={item.tagColor ?? C.dimText}>{item.tag}</Text>}
            <Text color={textColor}>{item.text}</Text>
        </Box>
    );
}
