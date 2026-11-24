import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],

    // Deterministic test configuration. These take precedence over .env,
    // because dotenv does not override variables that are already set.
    env: {
      NODE_ENV: "test",
      GEMINI_API_KEY: "test-api-key",
      GEMINI_MODEL: "test-model",
      GEMINI_TIMEOUT_MS: "200",
      GEMINI_ATTEMPT_TIMEOUT_MS: "200",
      GEMINI_MAX_RETRIES: "2",
      GEMINI_RETRY_DELAY_MS: "10",
      LOG_LEVEL: "silent"
    }
  }
});
