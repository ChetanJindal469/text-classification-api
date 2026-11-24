import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { AppError } from "../src/errors/app.error.js";
import type { AIProvider } from "../src/providers/ai-provider.interface.js";

const ENDPOINT = "/api/v1/classify";

describe("POST /api/v1/classify", () => {
  const classify = vi.fn<AIProvider["classify"]>();
  let app: FastifyInstance;

  beforeEach(async () => {
    classify.mockReset();

    app = buildApp({ classify });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("successful classification", () => {
    it("returns 200 with the category and confidence", async () => {
      classify.mockResolvedValue({ category: "Complaint", confidence: 0.95 });

      const response = await app.inject({
        method: "POST",
        url: ENDPOINT,
        payload: { text: "My order has not arrived yet." }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.json()).toEqual({
        success: true,
        data: { category: "Complaint", confidence: 0.95 }
      });
    });

    it("trims the text before sending it to the AI provider", async () => {
      classify.mockResolvedValue({ category: "Query", confidence: 0.9 });

      await app.inject({
        method: "POST",
        url: ENDPOINT,
        payload: { text: "  What is your return policy?  " }
      });

      expect(classify).toHaveBeenCalledWith("What is your return policy?");
    });

    it("accepts text at the 5000 character limit", async () => {
      classify.mockResolvedValue({ category: "Other", confidence: 0.4 });

      const response = await app.inject({
        method: "POST",
        url: ENDPOINT,
        payload: { text: "a".repeat(5000) }
      });

      expect(response.statusCode).toBe(200);
    });

    it("sets security headers", async () => {
      classify.mockResolvedValue({ category: "Feedback", confidence: 0.9 });

      const response = await app.inject({
        method: "POST",
        url: ENDPOINT,
        payload: { text: "Great service." }
      });

      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      // Helmet's global CSP is unchanged for API routes
      expect(response.headers["content-security-policy"]).toContain(
        "upgrade-insecure-requests"
      );
    });
  });

  describe("request validation", () => {
    it.each([
      ["text is missing", {}, "/text"],
      ["text is empty", { text: "" }, "/text"],
      ["text is whitespace only", { text: "   \n\t " }, "/text"],
      ["text is a number", { text: 123 }, "/text"],
      ["text is null", { text: null }, "/text"],
      ["text is an array", { text: ["hello"] }, "/text"],
      ["text exceeds 5000 characters", { text: "a".repeat(5001) }, "/text"],
      ["an unknown property is sent", { text: "hi", extra: true }, "/extra"]
    ])(
      "returns 400 VALIDATION_ERROR when %s",
      async (_label, payload, field) => {
        const response = await app.inject({
          method: "POST",
          url: ENDPOINT,
          payload
        });

        const body = response.json();

        expect(response.statusCode).toBe(400);
        expect(body).toMatchObject({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed"
          }
        });
        expect(body.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field })])
        );
        expect(typeof body.requestId).toBe("string");
        expect(classify).not.toHaveBeenCalled();
      }
    );

    it.each([
      ["a JSON array", "[]"],
      ["JSON null", "null"],
      ["a JSON string", '"hello"']
    ])("returns 400 when the body is %s", async (_label, payload) => {
      const response = await app.inject({
        method: "POST",
        url: ENDPOINT,
        headers: { "content-type": "application/json" },
        payload
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().success).toBe(false);
      expect(classify).not.toHaveBeenCalled();
    });

    it("returns 400 for malformed JSON", async () => {
      const response = await app.inject({
        method: "POST",
        url: ENDPOINT,
        headers: { "content-type": "application/json" },
        payload: '{"text": "unterminated'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().success).toBe(false);
      expect(classify).not.toHaveBeenCalled();
    });

    it("returns 400 for a text/plain body, which is not a JSON object", async () => {
      const response = await app.inject({
        method: "POST",
        url: ENDPOINT,
        headers: { "content-type": "text/plain" },
        payload: "My order is late"
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
      expect(classify).not.toHaveBeenCalled();
    });

    it("returns 415 for an unsupported content type", async () => {
      const response = await app.inject({
        method: "POST",
        url: ENDPOINT,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "text=My+order+is+late"
      });

      expect(response.statusCode).toBe(415);
      expect(response.json().success).toBe(false);
      expect(classify).not.toHaveBeenCalled();
    });

    it("returns 413 when the body exceeds 16 KB", async () => {
      const response = await app.inject({
        method: "POST",
        url: ENDPOINT,
        payload: { text: "a".repeat(17 * 1024) }
      });

      expect(response.statusCode).toBe(413);
      expect(response.json().success).toBe(false);
      expect(classify).not.toHaveBeenCalled();
    });
  });

  describe("AI provider errors", () => {
    it.each([
      [503, "AI_SERVICE_UNAVAILABLE", "AI service is temporarily unavailable"],
      [503, "AI_RATE_LIMIT_EXCEEDED", "AI provider rate limit exceeded"],
      [502, "INVALID_AI_RESPONSE", "AI returned invalid JSON"],
      [502, "AI_CONFIGURATION_ERROR", "AI provider configuration error"],
      [504, "AI_REQUEST_TIMEOUT", "AI classification request timed out"]
    ])(
      "returns %i %s without a fabricated classification",
      async (statusCode, code, message) => {
        classify.mockRejectedValue(new AppError(message, statusCode, code));

        const response = await app.inject({
          method: "POST",
          url: ENDPOINT,
          payload: { text: "My order is late." }
        });

        expect(response.statusCode).toBe(statusCode);
        expect(response.json()).toEqual({
          success: false,
          error: { code, message },
          requestId: expect.any(String)
        });
      }
    );

    it("returns a generic 500 for unexpected errors without leaking details", async () => {
      classify.mockRejectedValue(
        new Error("connection string postgres://user:secret@db")
      );

      const response = await app.inject({
        method: "POST",
        url: ENDPOINT,
        payload: { text: "My order is late." }
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred"
        },
        requestId: expect.any(String)
      });
      expect(response.body).not.toContain("secret");
    });
  });
});

describe("application routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp({ classify: vi.fn<AIProvider["classify"]>() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 404 ROUTE_NOT_FOUND for unknown routes", async () => {
    const response = await app.inject({ method: "GET", url: "/unknown" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "ROUTE_NOT_FOUND" }
    });
  });

  it("returns 404 for unsupported methods on the classify endpoint", async () => {
    const response = await app.inject({ method: "GET", url: ENDPOINT });

    expect(response.statusCode).toBe(404);
  });

  it("documents the classify endpoint in the OpenAPI specification", async () => {
    const response = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = response.json();
    const operation = spec.paths[ENDPOINT]?.post;

    expect(response.statusCode).toBe(200);
    expect(spec.openapi).toBe("3.0.3");
    expect(operation).toBeDefined();
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining(["200", "400", "413", "500", "502", "503", "504"])
    );
    expect(
      operation.requestBody.content["application/json"].schema.properties.text
    ).toMatchObject({ type: "string", minLength: 1, maxLength: 5000 });
  });

  it("serves the Swagger UI", async () => {
    const response = await app.inject({ method: "GET", url: "/docs/" });

    const csp = String(response.headers["content-security-policy"]);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    // Docs-only CSP: scripts restricted to self, no HTTPS upgrade, so the
    // UI also loads over plain HTTP on non-localhost hosts
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});
