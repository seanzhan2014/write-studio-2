import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // These views display private generated assets and remote model previews at
    // their original URL. They must work without a Next image optimizer service.
    files: ["app/ui/ai-services.tsx", "app/ui/character-photos.tsx", "app/ui/character-visual.tsx", "app/ui/illustration-generator.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "work/**",
    "outputs/**",
    "dist/**",
    ".test-data/**",
    ".writer-studio-restart-*/**",
  ]),
]);

export default eslintConfig;
