import { GoogleGenAI } from "@google/genai";

import { env } from "../config/env.js";
import { AppError } from "../errors/app.error.js";

import {
  aiResponseSchema,
  classificationResultSchema
} from "../schemas/classification.schema.js";

import {
  CLASSIFICATION_SYSTEM_PROMPT,
  buildClassificationPrompt
} from "../prompts/classification.prompt.js";

import type { ClassificationResult } from "../types/classification.type.js";

import type { AIProvider } from "./ai-provider.interface.js";

import { withRetry } from "../utils/retry.util.js";

export class GeminiProvider implements AIProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly timeout: number;
  private readonly attemptTimeout: number;

  constructor() {
    if (!env.GEMINI_API_KEY?.trim()) {
      throw new Error("GEMINI_API_KEY is required");
    }

    if (!env.GEMINI_MODEL?.trim()) {
      throw new Error("GEMINI_MODEL is required");
    }

    this.client = new GoogleGenAI({
      apiKey: env.GEMINI_API_KEY
    });

    this.model = env.GEMINI_MODEL;
    this.timeout = env.GEMINI_TIMEOUT_MS;
    this.attemptTimeout = env.GEMINI_ATTEMPT_TIMEOUT_MS;
  }

  private getErrorStatus(error: unknown): number | undefined {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
    ) {
      return error.status;
    }

    return undefined;
  }

  private isRetryableError(error: unknown): boolean {
    const status = this.getErrorStatus(error);

    return status !== undefined && [500, 502, 503, 504].includes(status);
  }

  async classify(text: string): Promise<ClassificationResult> {
    // One deadline for the whole operation, including retries and backoff.
    const signal = AbortSignal.timeout(this.timeout);

    // Set when the latest attempt hit its own timeout (not the overall one)
    let attemptTimedOut = false;

    const attempt = async () => {
      // Bound each attempt so a slow or hung upstream call can be retried
      // while the overall deadline still has time left.
      const attemptSignal = AbortSignal.timeout(this.attemptTimeout);

      attemptTimedOut = false;

      try {
        return await this.client.models.generateContent({
          model: this.model,

          contents: buildClassificationPrompt(text),

          config: {
            systemInstruction: CLASSIFICATION_SYSTEM_PROMPT,

            temperature: 0.1,
            maxOutputTokens: 1024,

            responseMimeType: "application/json",
            responseJsonSchema: aiResponseSchema,

            abortSignal: AbortSignal.any([signal, attemptSignal])
          }
        });
      } catch (error: unknown) {
        attemptTimedOut = attemptSignal.aborted && !signal.aborted;

        throw error;
      }
    };

    try {
      // Retries are handled here only. The SDK retries only when
      // httpOptions.retryOptions is set, which this client does not do.
      const response = await withRetry(attempt, {
        maxRetries: env.GEMINI_MAX_RETRIES,

        initialDelayMs: env.GEMINI_RETRY_DELAY_MS,

        signal,

        shouldRetry: (error) => attemptTimedOut || this.isRetryableError(error)
      });

      const rawResponse = response.text;

      if (!rawResponse?.trim()) {
        throw new AppError(
          "AI returned an empty response",
          502,
          "INVALID_AI_RESPONSE"
        );
      }

      let parsedResponse: unknown;

      try {
        parsedResponse = JSON.parse(rawResponse);
      } catch {
        throw new AppError(
          "AI returned invalid JSON",
          502,
          "INVALID_AI_RESPONSE"
        );
      }

      const result = classificationResultSchema.safeParse(parsedResponse);

      if (!result.success) {
        throw new AppError(
          "AI response failed schema validation",
          502,
          "INVALID_AI_RESPONSE"
        );
      }

      return result.data;
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }

      const status = this.getErrorStatus(error);

      // Log only sanitized metadata. The upstream error message can contain
      // arbitrary provider response bodies, so it is deliberately not kept.
      const metadata = {
        providerStatus: status,
        providerErrorType: error instanceof Error ? error.name : typeof error
      };

      if (signal.aborted || attemptTimedOut) {
        throw new AppError(
          "AI classification request timed out",
          504,
          "AI_REQUEST_TIMEOUT",
          metadata
        );
      }

      if (status === 429) {
        throw new AppError(
          "AI provider rate limit or quota exceeded",
          503,
          "AI_RATE_LIMIT_EXCEEDED",
          metadata
        );
      }

      if (status !== undefined && [400, 401, 403, 404].includes(status)) {
        throw new AppError(
          "AI provider configuration error",
          502,
          "AI_CONFIGURATION_ERROR",
          metadata
        );
      }

      throw new AppError(
        "AI classification service is temporarily unavailable",
        503,
        "AI_SERVICE_UNAVAILABLE",
        metadata
      );
    }
  }
}
