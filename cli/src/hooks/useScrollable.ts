import { useState, useCallback, useEffect } from "react";

export function useScrollable(totalItems: number, visibleHeight: number) {
    const [offset, setOffset] = useState(0);
    const maxOffset = Math.max(0, totalItems - visibleHeight);

    // Clamp offset when items or height change
    useEffect(() => {
        setOffset((prev) => Math.min(prev, maxOffset));
    }, [maxOffset]);

    const scrollUp = useCallback((n = 1) => setOffset((prev) => Math.max(0, prev - n)), []);

    const scrollDown = useCallback(
        (n = 1) => setOffset((prev) => Math.min(maxOffset, prev + n)),
        [maxOffset],
    );

    const scrollPageUp = useCallback(
        () => setOffset((prev) => Math.max(0, prev - visibleHeight)),
        [visibleHeight],
    );

    const scrollPageDown = useCallback(
        () => setOffset((prev) => Math.min(maxOffset, prev + visibleHeight)),
        [maxOffset, visibleHeight],
    );

    const scrollToStart = useCallback(() => setOffset(0), []);
    const scrollToEnd = useCallback(() => setOffset(maxOffset), [maxOffset]);

    return {
        offset,
        setOffset,
        scrollUp,
        scrollDown,
        scrollPageUp,
        scrollPageDown,
        scrollToStart,
        scrollToEnd,
        maxOffset,
        isAtBottom: offset >= maxOffset,
        isAtTop: offset <= 0,
    };
}
