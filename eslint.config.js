import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import unusedImports from "eslint-plugin-unused-imports";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "unused-imports": unusedImports,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // === Agent mistake catchers ===

      // Agents leave unused vars/imports constantly
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Auto-removable unused imports (agents leave these behind after refactoring)
      "unused-imports/no-unused-imports": "error",

      // Agents forget to await promises
      "@typescript-eslint/no-floating-promises": "error",

      // Agents use `any` when they can't figure out the type
      "@typescript-eslint/no-explicit-any": "warn",

      // console.log in src/ breaks MCP (stdout is JSON-RPC)
      // CLI files are exempt — they intentionally use console.log
      "no-console": "off", // handled per-file below

      // Agents write unreachable code after early returns
      "no-unreachable": "error",

      // Agents sometimes duplicate switch cases
      "no-duplicate-case": "error",

      // Agents forget break in switch statements
      "no-fallthrough": "error",

      // Catch == instead of === (agents mix these up)
      eqeqeq: ["error", "always"],

      // No var (agents sometimes regress to var)
      "no-var": "error",

      // Prefer const over let when not reassigned
      "prefer-const": "error",

      // Agents sometimes use require() in ESM
      "@typescript-eslint/no-require-imports": "error",
    },
  },
  // Forbid console.log in server code (stdout = MCP channel)
  {
    files: ["src/**/*.ts"],
    ignores: ["src/cli/**/*.ts", "src/index.ts"],
    rules: {
      "no-console": [
        "error",
        {
          allow: ["error", "warn"],
        },
      ],
    },
  },
  // CLI files can use console.log (they output to terminal)
  {
    files: ["src/cli/**/*.ts", "src/index.ts"],
    rules: {
      "no-console": "off",
    },
  },
  // Tests: relax rules, use default parser (no project service needed)
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: null,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  // Ignore build output
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  }
);
