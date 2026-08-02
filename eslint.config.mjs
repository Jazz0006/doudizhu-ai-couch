import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["scripts/**/*.{cjs,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.nodeBuiltin,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["apps/web/public/*-worklet.js"],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: "readonly",
        Float32Array: "readonly",
        Boolean: "readonly",
        Math: "readonly",
        registerProcessor: "readonly",
        sampleRate: "readonly",
      },
    },
  },
  prettier,
);
