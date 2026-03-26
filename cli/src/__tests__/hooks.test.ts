import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";

// ── Helper to test hooks via Ink's render ─────────────────────────────

type HookResult<T> = { current: T };

function renderHook<T>(useHookFn: () => T): {
    result: HookResult<T>;
    rerender: () => void;
    unmount: () => void;
} {
    const result: HookResult<T> = { current: undefined as T };

    function TestComponent() {
        result.current = useHookFn();
        return React.createElement(Text, null, "test");
    }

    const instance = render(React.createElement(TestComponent));
    return {
        result,
        rerender: () => instance.rerender(React.createElement(TestComponent)),
        unmount: () => instance.unmount(),
    };
}

// ── useBatchedState ───────────────────────────────────────────────────

describe("useBatchedState", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    async function importHook() {
        const { useBatchedState } = await import("../hooks/useBatchedState.js");
        return useBatchedState;
    }

    it("starts with initial state", async () => {
        const useBatchedState = await importHook();
        const { result } = renderHook(() => useBatchedState<string>([]));
        expect(result.current[0]).toEqual([]);
    });

    it("buffers items until flush interval", async () => {
        const useBatchedState = await importHook();
        const { result, rerender } = renderHook(() => useBatchedState<string>([], 100));

        // Push items — should not appear yet
        result.current[1]("a");
        result.current[1]("b");
        rerender();
        expect(result.current[0]).toEqual([]);

        // Advance timer past interval — flush should fire
        jest.advanceTimersByTime(100);
        rerender();
        expect(result.current[0]).toEqual(["a", "b"]);
    });

    it("manual flush works immediately", async () => {
        const useBatchedState = await importHook();
        const { result, rerender } = renderHook(() => useBatchedState<string>([], 1000));

        result.current[1]("immediate");
        rerender();
        expect(result.current[0]).toEqual([]);

        // Manual flush — don't wait for timer
        result.current[2]();
        rerender();
        expect(result.current[0]).toEqual(["immediate"]);
    });

    it("does nothing when buffer is empty on flush", async () => {
        const useBatchedState = await importHook();
        const { result, rerender } = renderHook(() => useBatchedState<string>([]));

        jest.advanceTimersByTime(200);
        rerender();
        expect(result.current[0]).toEqual([]);
    });

    it("starts with pre-populated initial state", async () => {
        const useBatchedState = await importHook();
        const { result } = renderHook(() => useBatchedState<string>(["x", "y"]));
        expect(result.current[0]).toEqual(["x", "y"]);
    });

    it("stop() flushes remaining and prevents further timer flushes", async () => {
        const useBatchedState = await importHook();
        const { result, rerender } = renderHook(() => useBatchedState<string>([], 100));

        // Push items and stop (which flushes)
        result.current[1]("a");
        result.current[1]("b");
        result.current[3](); // stop
        rerender();
        expect(result.current[0]).toEqual(["a", "b"]);

        // Push more items — timer is stopped, so they won't flush
        result.current[1]("c");
        jest.advanceTimersByTime(200);
        rerender();
        expect(result.current[0]).toEqual(["a", "b"]);
    });
});

// ── useScrollable ─────────────────────────────────────────────────────

describe("useScrollable", () => {
    async function importHook() {
        const { useScrollable } = await import("../hooks/useScrollable.js");
        return useScrollable;
    }

    it("starts at offset 0", async () => {
        const useScrollable = await importHook();
        const { result } = renderHook(() => useScrollable(100, 20));
        expect(result.current.offset).toBe(0);
        expect(result.current.isAtTop).toBe(true);
        expect(result.current.isAtBottom).toBe(false);
    });

    it("calculates maxOffset correctly", async () => {
        const useScrollable = await importHook();
        const { result } = renderHook(() => useScrollable(100, 20));
        expect(result.current.maxOffset).toBe(80);
    });

    it("maxOffset is 0 when items fit in view", async () => {
        const useScrollable = await importHook();
        const { result } = renderHook(() => useScrollable(10, 20));
        expect(result.current.maxOffset).toBe(0);
        expect(result.current.isAtTop).toBe(true);
        expect(result.current.isAtBottom).toBe(true);
    });

    it("scrollDown increases offset", async () => {
        const useScrollable = await importHook();
        const { result, rerender } = renderHook(() => useScrollable(100, 20));

        result.current.scrollDown(5);
        rerender();
        expect(result.current.offset).toBe(5);
        expect(result.current.isAtTop).toBe(false);
    });

    it("scrollDown clamps to maxOffset", async () => {
        const useScrollable = await importHook();
        const { result, rerender } = renderHook(() => useScrollable(100, 20));

        result.current.scrollDown(999);
        rerender();
        expect(result.current.offset).toBe(80);
        expect(result.current.isAtBottom).toBe(true);
    });

    it("scrollUp decreases offset", async () => {
        const useScrollable = await importHook();
        const { result, rerender } = renderHook(() => useScrollable(100, 20));

        result.current.scrollDown(10);
        rerender();
        result.current.scrollUp(3);
        rerender();
        expect(result.current.offset).toBe(7);
    });

    it("scrollUp clamps to 0", async () => {
        const useScrollable = await importHook();
        const { result, rerender } = renderHook(() => useScrollable(100, 20));

        result.current.scrollDown(5);
        rerender();
        result.current.scrollUp(50);
        rerender();
        expect(result.current.offset).toBe(0);
        expect(result.current.isAtTop).toBe(true);
    });

    it("scrollPageDown moves by visibleHeight", async () => {
        const useScrollable = await importHook();
        const { result, rerender } = renderHook(() => useScrollable(100, 20));

        result.current.scrollPageDown();
        rerender();
        expect(result.current.offset).toBe(20);
    });

    it("scrollPageUp moves by visibleHeight", async () => {
        const useScrollable = await importHook();
        const { result, rerender } = renderHook(() => useScrollable(100, 20));

        result.current.scrollDown(50);
        rerender();
        result.current.scrollPageUp();
        rerender();
        expect(result.current.offset).toBe(30);
    });

    it("scrollToEnd jumps to maxOffset", async () => {
        const useScrollable = await importHook();
        const { result, rerender } = renderHook(() => useScrollable(100, 20));

        result.current.scrollToEnd();
        rerender();
        expect(result.current.offset).toBe(80);
        expect(result.current.isAtBottom).toBe(true);
    });

    it("scrollToStart jumps to 0", async () => {
        const useScrollable = await importHook();
        const { result, rerender } = renderHook(() => useScrollable(100, 20));

        result.current.scrollToEnd();
        rerender();
        result.current.scrollToStart();
        rerender();
        expect(result.current.offset).toBe(0);
        expect(result.current.isAtTop).toBe(true);
    });

    it("default scroll step is 1", async () => {
        const useScrollable = await importHook();
        const { result, rerender } = renderHook(() => useScrollable(100, 20));

        result.current.scrollDown();
        rerender();
        expect(result.current.offset).toBe(1);

        result.current.scrollUp();
        rerender();
        expect(result.current.offset).toBe(0);
    });
});
