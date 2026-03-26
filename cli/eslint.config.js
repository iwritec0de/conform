import js from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // ── Global ignores ────────────────────────────────────────────────
  {
    ignores: ["dist/", "node_modules/", "jest.config.cjs"],
  },

  // ── Base: ESLint recommended ──────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript: recommended + type-checked ────────────────────────
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── SonarJS: recommended ──────────────────────────────────────────
  sonarjs.configs.recommended,

  // ── React (JSX) ───────────────────────────────────────────────────
  {
    files: ["**/*.tsx"],
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "18" },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/set-state-in-effect": "warn", // Ink streaming architecture requires setState in effects
    },
  },

  // ── Project-wide rule overrides ───────────────────────────────────
  {
    rules: {
      // TypeScript handles these better
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Practical adjustments for CLI code
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",

      // SonarJS tuning — keep the valuable rules, relax the noisy ones
      "sonarjs/cognitive-complexity": ["warn", 25],
      "sonarjs/no-duplicate-string": ["warn", { threshold: 5 }],
      "sonarjs/no-identical-functions": "warn",
      "sonarjs/no-nested-template-literals": "off", // Common in JSX/template heavy code
      "sonarjs/no-nested-conditional": "warn", // Ternaries in JSX are idiomatic
      "sonarjs/prefer-read-only-props": "warn",
      "sonarjs/prefer-regexp-exec": "warn",
      "sonarjs/slow-regex": "warn",
      "sonarjs/no-os-command-from-path": "off", // CLI tool — spawning bash is intentional
      "sonarjs/unused-import": "warn",
      "sonarjs/no-unused-vars": "off", // Conflicts with @typescript-eslint/no-unused-vars
      "sonarjs/no-dead-store": "warn",
      "sonarjs/no-nested-functions": "off", // React hooks use nested functions extensively

      // ANSI escape sequences are intentional in a CLI tool
      "no-control-regex": "off",
    },
  },

  // ── Test file overrides ───────────────────────────────────────────
  {
    files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-identical-functions": "off",
      "sonarjs/no-dead-store": "off",
      "sonarjs/slow-regex": "off",
      "sonarjs/unused-import": "off",
      "sonarjs/prefer-regexp-exec": "off",
      "sonarjs/no-os-command-from-path": "off",
    },
  },

  // ── Prettier: must be last to disable conflicting rules ───────────
  prettier,
);
