import { setTimeout as sleep } from "node:timers/promises";

interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  signal: AbortSignal;
  shouldRetry: (error: unknown) => boolean;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let attempt = 0;

  while (true) {
    options.signal.throwIfAborted();

    try {
      return await operation();
    } catch (error: unknown) {
      if (
        options.signal.aborted ||
        attempt >= options.maxRetries ||
        !options.shouldRetry(error)
      ) {
        throw error;
      }

      const delay = options.initialDelayMs * Math.pow(2, attempt);

      const jitter = Math.floor(Math.random() * 250);

      attempt++;

      await sleep(delay + jitter, undefined, {
        signal: options.signal
      });
    }
  }
}
