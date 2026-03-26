import React from "react";
import { Box, Text } from "ink";
import { C } from "../theme.js";

interface ScrollableViewProps {
    lineCount: number;
    visibleHeight: number;
    scrollOffset: number;
    paddingTop?: number;
    children: React.ReactNode;
}

export function ScrollableView({
    lineCount,
    visibleHeight,
    scrollOffset,
    paddingTop,
    children,
}: Readonly<ScrollableViewProps>) {
    const maxOffset = Math.max(0, lineCount - visibleHeight);
    const showScrollUp = scrollOffset > 0;
    const showScrollDown = scrollOffset < maxOffset;

    return (
        <Box flexDirection="column" height={visibleHeight} paddingTop={paddingTop}>
            {showScrollUp && (
                <Box paddingLeft={2}>
                    <Text color={C.white}>↑ scroll up for more</Text>
                </Box>
            )}

            {children}

            {showScrollDown && (
                <Box paddingLeft={2}>
                    <Text color={C.white}>↓ scroll down for more</Text>
                </Box>
            )}
        </Box>
    );
}
