import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withRetry } from "../src/utils/retry.util.js";

const transientError = new Error("transient");

function options(signal: AbortSignal = new AbortController().signal) {
  return {
    maxRetries: 2,
    initialDelayMs: 1,
    signal,
    shouldRetry: (error: unknown) => error === transientError
  };
}

describe("withRetry", () => {
  beforeEach(() => {
    // Remove jitter so backoff timing is deterministic
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the result without retrying when the first attempt succeeds", async () => {
    const operation = vi.fn().mockResolvedValue("ok");

    await expect(withRetry(operation, options())).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries retryable errors and returns the eventual result", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValue("ok");

    await expect(withRetry(operation, options())).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("throws the last error once maxRetries is exhausted", async () => {
    const operation = vi.fn().mockRejectedValue(transientError);

    await expect(withRetry(operation, options())).rejects.toBe(transientError);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const fatalError = new Error("fatal");
    const operation = vi.fn().mockRejectedValue(fatalError);

    await expect(withRetry(operation, options())).rejects.toBe(fatalError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("stops waiting and rejects when the signal aborts during backoff", async () => {
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue(transientError);

    const promise = withRetry(operation, {
      ...options(controller.signal),
      initialDelayMs: 60_000
    });

    setTimeout(() => controller.abort(), 10);

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not call the operation when the signal is already aborted", async () => {
    const operation = vi.fn().mockResolvedValue("ok");

    await expect(
      withRetry(operation, options(AbortSignal.abort()))
    ).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
  });
});
