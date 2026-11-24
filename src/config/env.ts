import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  HOST: z.string().default("0.0.0.0"),

  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  GEMINI_API_KEY: z.string().trim().min(1),

  GEMINI_MODEL: z.string().trim().min(1),

  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

  GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  GEMINI_RETRY_DELAY_MS: z.coerce.number().int().positive().default(1000),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info")
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error(
    "Invalid environment configuration:",
    result.error.issues.map(({ path, message }) => ({
      field: path.join("."),
      message
    }))
  );

  throw new Error("Environment validation failed");
}

export const env = result.data;

export type Env = z.infer<typeof envSchema>;
