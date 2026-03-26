import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Like useState, but batches rapid updates into periodic flushes.
 * Reduces re-renders from N individual updates to N/batch_interval updates.
 *
 * Uses a mutable ref internally to avoid O(N²) spread-copy patterns.
 * The returned array is a snapshot updated on each flush.
 */
export function useBatchedState<T>(
    initial: T[],
    intervalMs = 100,
): [T[], (item: T) => void, () => void, () => void, () => T[]] {
    // Mutable accumulator — the source of truth
    const allItemsRef = useRef<T[]>([...initial]);
    // Snapshot exposed to consumers — updated on flush
    const [items, setItems] = useState<T[]>(initial);
    const bufferRef = useRef<T[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const stoppedRef = useRef(false);

    const flush = useCallback(() => {
        if (bufferRef.current.length > 0) {
            const batch = bufferRef.current;
            bufferRef.current = [];
            allItemsRef.current.push(...batch);
            // Single snapshot copy — O(N) once, not O(N²) cumulative
            setItems([...allItemsRef.current]);
        }
    }, []);

    /** Stop the periodic timer. Call when no more data is expected. */
    const stop = useCallback(() => {
        stoppedRef.current = true;
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        // Final flush
        flush();
    }, [flush]);

    // Start the flush timer on mount (unless stopped)
    useEffect(() => {
        if (stoppedRef.current) return;
        timerRef.current = setInterval(flush, intervalMs);
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            flush();
        };
    }, [flush, intervalMs]);

    const push = useCallback((item: T) => {
        bufferRef.current.push(item);
    }, []);

    /** Get all accumulated items (reads from ref, no React delay). */
    const getAll = useCallback(() => {
        // Include any unflushed buffer items
        return [...allItemsRef.current, ...bufferRef.current];
    }, []);

    return [items, push, flush, stop, getAll];
}
