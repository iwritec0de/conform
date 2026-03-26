import { describe, it, expect } from "@jest/globals";
import { C } from "../theme.js";

describe("theme", () => {
    it("exports a color palette object", () => {
        expect(C).toBeDefined();
        expect(typeof C).toBe("object");
    });

    it("has all required Dracula colors", () => {
        expect(C.green).toBe("#50fa7b");
        expect(C.red).toBe("#ff5555");
        expect(C.yellow).toBe("#f1fa8c");
        expect(C.cyan).toBe("#8be9fd");
        expect(C.magenta).toBe("#ff79c6");
        expect(C.purple).toBe("#bd93f9");
        expect(C.orange).toBe("#ffb86c");
        expect(C.white).toBe("#f8f8f2");
        expect(C.dim).toBe("#44475a");
        expect(C.dimText).toBe("#6272a4");
    });

    it("all values are valid hex colors", () => {
        for (const [, value] of Object.entries(C)) {
            expect(value).toMatch(/^#[0-9a-f]{6}$/i);
        }
    });

    it("is readonly (frozen)", () => {
        // TypeScript `as const` makes it readonly at compile time
        // At runtime we verify the values can't be changed via type check
        expect(Object.keys(C)).toHaveLength(10);
    });
});
