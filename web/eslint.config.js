import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["e2e/.auth/", "app/", "server/", "node_modules/"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // Allow any in test code (Playwright evaluate calls often need it)
      "@typescript-eslint/no-explicit-any": "off",

      // Allow console in test files
      "no-console": "off",

      "no-useless-escape": "error",
    },
  },
);
