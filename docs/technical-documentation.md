# AI-Assisted Text Classification API — Technical Documentation

**Candidate:** Chetan Jindal
**Position:** Software Developer, Indus Net Technologies
**Stack:** Node.js 24 · Fastify 5 · TypeScript (strict) · Google Gemini (`@google/genai`) · Zod · Vitest

---

## 1. Summary

The service exposes one REST endpoint, `POST /api/v1/classify`. It accepts a text string, asks a Google Gemini model to classify it as **Complaint**, **Query**, **Feedback** or **Other**, and returns the category with a confidence score between 0 and 1.

Beyond the core requirement, the work focused on making the AI integration predictable and tolerant of failure. Requests are strictly validated, model output is checked against a schema, timeouts and retries are explicit, error responses follow one consistent shape, the service never fabricates a result when the AI fails, and a deterministic test suite runs without network access.

## 2. Requirement coverage

| Requirement                               | Implementation                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| REST API with a single POST endpoint      | `POST /api/v1/classify` (Fastify)                                                                           |
| Accept a text string                      | JSON body `{ "text": string }`, 1–5000 characters, strictly validated                                       |
| Send text to an AI model                  | `GeminiProvider` using the official `@google/genai` SDK; model set by `GEMINI_MODEL`                        |
| Return category and confidence score      | `{ success: true, data: { category, confidence } }`                                                         |
| Controller, routing and service structure | `routes/` → `controllers/` → `services/` → `providers/`                                                     |
| Error handling                            | `AppError` and a central Fastify error handler; consistent JSON error shape; specific codes for AI failures |
| Source code                               | Git repository                                                                                              |
| README                                    | Setup, configuration, API examples, error codes, architecture, AI integration, testing, limitations         |
| Postman collection (optional)             | `postman/text-classification-api.postman_collection.json`, 13 requests with test scripts                    |
| Additional                                | OpenAPI/Swagger UI at `/docs`, 66 automated tests (mocked AI), ESLint, Prettier, Helmet, graceful shutdown  |

## 3. Architecture

```text
Client
  │  POST /api/v1/classify  { "text": "..." }
  ▼
Fastify  ── AJV schema validation, 16 KB body limit, Helmet headers
  ▼
Route       registers the endpoint with request/response schemas (also feeds OpenAPI)
  ▼
Controller  HTTP concerns: read body, call service, build the response, log outcome
  ▼
Service     business logic: input normalisation (trim)
  ▼
AIProvider  interface ── GeminiProvider
              • system prompt + JSON-encoded user text
              • structured JSON output with a response schema
              • overall deadline + per-attempt timeout, retry with backoff
              • Zod validation of model output
              • maps provider failures to typed AppErrors
  ▼
Error handler  converts every failure to { success: false, error: { code, message }, requestId }
```

**Key design decisions**

- **Provider interface and dependency injection.** `buildApp(aiProvider)` receives the provider. The HTTP layer doesn't know about Gemini, so tests can inject a mock and another provider could be added by implementing `classify(text)`.
- **Two schema systems for two different trust boundaries.** JSON Schema (AJV) validates incoming HTTP requests and also generates the OpenAPI documentation. Zod validates the AI's output at runtime and provides the TypeScript type for it.
- **Fail-fast configuration.** Environment variables are validated with Zod at startup, so a missing API key or invalid number stops the process immediately instead of failing on the first request.
- **No speculative infrastructure.** No database, cache, queue or authentication; the assignment doesn't need them. Section 9 lists what a production deployment would add.

## 4. AI integration

### 4.1 Gemini request

| Setting                                   | Value / purpose                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `systemInstruction`                       | Classification rules, kept separate from user data                      |
| `contents`                                | `JSON.stringify({ text })`: user text sent as a JSON value              |
| `responseMimeType` / `responseJsonSchema` | Forces JSON with `category` ∈ the four values and `confidence` ∈ [0, 1] |
| `temperature`                             | 0.1, for consistent output                                              |
| `abortSignal`                             | Combines the overall deadline with a per-attempt timeout                |

### 4.2 Prompt design

The system prompt defines each category, then adds rules for borderline cases:

- Pick the **dominant intent** when several apply.
- A question that mainly expresses dissatisfaction ("Why has my refund still not arrived?") is a **Complaint**.
- A constructive suggestion that reports no failure is **Feedback**.
- **Other** covers greetings, unrelated statements, spam and meaningless text.
- Confidence bands: 0.9–1.0 for clear intent, 0.6–0.89 for overlapping intent, below 0.6 for ambiguous or very short text.

**Prompt-injection mitigation** works in three layers:

1. Instructions live only in the system instruction.
2. User text is a JSON string value, and the prompt tells the model to treat it as untrusted data.
3. Even if the model is manipulated, the response schema and Zod validation mean the API can only ever return one of the four categories and a number in [0, 1].

### 4.3 Output validation

Structured output reduces but doesn't remove malformed responses. The provider rejects empty output, invalid JSON, unknown or wrongly cased categories, out-of-range or non-numeric confidence, and unexpected extra fields, returning `502 INVALID_AI_RESPONSE`. These failures are deterministic, so they aren't retried.

### 4.4 About the confidence score

The confidence value is **generated by the model**. It is not a statistically calibrated probability: 0.9 doesn't mean the answer is correct 90% of the time. It helps rank results and flag ambiguous inputs. Calibration would need a labelled evaluation set, which is out of scope. The API never fabricates a confidence score or a default category; if the AI call fails, the client receives an error.

## 5. Reliability: timeouts, retries and Gemini 503 errors

During development, Gemini intermittently returned **HTTP 503 ("This model is currently experiencing high demand")**, and some requests exceeded the timeout. A direct probe showed that the 503 responses are themselves slow: they arrived after 13.6 s and 19.9 s. With the original 15 s budget and no per-attempt limit, a slow 503 therefore surfaced as a `504` timeout with no time left to retry. Most observed timeouts were capacity errors, not slow classifications; successful calls typically took 1–2 s.

The service handles this as follows:

- **Overall deadline.** A single `AbortSignal.timeout(GEMINI_TIMEOUT_MS)` covers the whole operation, including all attempts and backoff waits. The code default is 15 s; `.env.example` sets the recommended 30 s. Clients get an answer or a `504` within a predictable time. Fastify's `requestTimeout` limits only how long the server waits to receive the request, not the handler, so it doesn't conflict with a 30 s budget.
- **Per-attempt timeout.** Each attempt also gets `AbortSignal.timeout(GEMINI_ATTEMPT_TIMEOUT_MS)` (default 10 s), combined with the overall deadline through `AbortSignal.any`. A slow or hung attempt is cancelled and retried while the overall deadline has time left. With 30 s overall, 10 s per attempt and 2 retries, a slow 503 no longer uses up the whole budget. If the overall deadline expires, no further attempt starts.
- **Selective retries.** Transient upstream errors (500, 502, 503, 504) and per-attempt timeouts are retried, up to `GEMINI_MAX_RETRIES` (default 2), with exponential backoff (1 s, 2 s) plus jitter. The backoff wait is cancelled as soon as the overall deadline expires.
- **Not retried:** 429 rate limits (retrying makes them worse), 4xx configuration errors (they won't fix themselves), and malformed output.
- **No double retries.** I checked the SDK source: in `@google/genai` 3.6.1 the built-in retry (p-retry) is used only when `httpOptions.retryOptions` is configured, and this client doesn't configure it. Each classification therefore makes at most `1 + GEMINI_MAX_RETRIES` calls. Enabling both layers would multiply attempts (up to 15).
- **Diagnosable failures with sanitized logs.** Provider failures are logged with the application error code, HTTP status, provider HTTP status and upstream error type (for example `providerStatus: 503, providerErrorType: "ApiError"`). That's enough to tell a capacity 503 from a timeout, a network error or an invalid key. The upstream error message is deliberately not kept, because it can contain arbitrary provider response bodies. The client sees only a generic message.
- **Model choice is configuration.** `GEMINI_MODEL` can be changed without code changes. Automatic fallback to a second model was considered and rejected for this scope: it adds configuration and makes results depend on which model answered.
- **Thinking configuration was evaluated and left unset.** `gemini-3.5-flash-lite` supports thinking, but used 0 thinking tokens with the current settings. `thinkingLevel: MINIMAL` was accepted but made no measurable difference to latency, and `thinkingBudget: 0` is rejected with HTTP 400. Adding either would tie the request to particular models with no benefit.

## 6. Error handling

Every error response has the same shape and includes `requestId`, which matches the server log entry:

```json
{
  "success": false,
  "error": { "code": "AI_SERVICE_UNAVAILABLE", "message": "..." },
  "requestId": "req-7"
}
```

| HTTP | Code                             | Cause                                              |
| ---- | -------------------------------- | -------------------------------------------------- |
| 400  | `VALIDATION_ERROR`               | Invalid body (with per-field `details`)            |
| 400  | `FST_ERR_CTP_INVALID_JSON_BODY`  | Malformed JSON                                     |
| 404  | `ROUTE_NOT_FOUND`                | Unknown route or method                            |
| 413  | `FST_ERR_CTP_BODY_TOO_LARGE`     | Body over 16 KB                                    |
| 415  | `FST_ERR_CTP_INVALID_MEDIA_TYPE` | Unsupported content type                           |
| 500  | `INTERNAL_SERVER_ERROR`          | Unexpected error (details logged, never returned)  |
| 502  | `INVALID_AI_RESPONSE`            | Model output failed validation                     |
| 502  | `AI_CONFIGURATION_ERROR`         | Gemini rejected the request (invalid key or model) |
| 503  | `AI_SERVICE_UNAVAILABLE`         | Gemini unavailable after retries                   |
| 503  | `AI_RATE_LIMIT_EXCEEDED`         | Gemini rate limit or quota                         |
| 504  | `AI_REQUEST_TIMEOUT`             | Deadline exceeded                                  |

## 7. Security

- API key loaded only from the environment. `.env` is git-ignored and has never been committed. A scan of the full git history and the working tree found neither the key value nor any Google API key pattern.
- Input text, request bodies, headers and upstream error bodies aren't logged. Real Gemini errors (an invalid model and an invalid key) were triggered at `trace` log level. The logs contained only the sanitized metadata described in Section 5: no API key, `x-goog-api-key` header, authorization or cookie value, submitted text, or provider response body.
- 5xx responses never expose internal error messages.
- Strict validation: no type coercion, no extra properties, field and body size limits.
- Helmet sets security headers, including a content security policy, globally and unchanged. Only the Swagger UI routes (`/docs`) use a documentation-specific CSP: scripts are restricted to the same origin, and `upgrade-insecure-requests` is left out so the docs also load over plain HTTP on non-localhost hosts. Both properties are covered by automated tests and were checked in headless Chrome.

## 8. Testing and verification

Verification had two separate parts: **automated tests with a mocked AI**, which check the service's behaviour, and a **manual live evaluation against Gemini**, which checks classification quality.

### 8.1 Automated tests (mocked AI)

The test suite (Vitest) is deterministic and makes **no network calls**. The Gemini SDK is mocked, and HTTP tests use Fastify's `inject()` with a mock provider.

| Suite                  | Tests  | Scope                                                                                                       |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| API integration        | 29     | Success path, all validation failures, 413/415, error mapping, 404, OpenAPI, Swagger UI and docs CSP        |
| Gemini provider (unit) | 31     | SDK request contents, malformed output (12 cases), retry, 429/4xx/5xx/network, sanitized metadata, timeouts |
| Retry utility (unit)   | 6      | Backoff, exhaustion, non-retryable errors, abort handling                                                   |
| **Total**              | **66** | **All passing**                                                                                             |

To check that the tests detect real defects, I deliberately broke behaviour and confirmed the tests failed:

- Removing 503 retrying and breaking the validation-error field mapping caused 7 failures.
- Disabling per-attempt retries and leaking upstream error text into the logged error caused 8 failures.

All tests passed again after the code was restored.

Final verification run:

| Check                                     | Result            |
| ----------------------------------------- | ----------------- |
| `npm run typecheck` (src, tests, scripts) | Pass              |
| `npm run build`                           | Pass              |
| `npm run lint`                            | Pass (0 problems) |
| `npm run format:check`                    | Pass              |
| `npm test`                                | 66 / 66 passed    |

### 8.2 Live evaluation against Gemini (manual)

`scripts/test-gemini.ts` was run once against the real API with `gemini-3.5-flash-lite` on 25 November 2026. That run used the earlier settings (15 s overall budget, no per-attempt timeout):

| Group            | Samples | Correct (1st pass) | Provider errors (1st pass) | Correct after rerun of errors |
| ---------------- | ------- | ------------------ | -------------------------- | ----------------------------- |
| Four categories  | 4       | 3                  | 1 (503 after retries)      | 4                             |
| Ambiguous        | 5       | 5                  | 0                          | 5                             |
| Hindi            | 2       | 2                  | 0                          | 2                             |
| Bengali          | 2       | 1                  | 1 (504 timeout)            | 2                             |
| Mixed language   | 3       | 3                  | 0                          | 3                             |
| Prompt injection | 4       | 1                  | 3 (504 timeout)            | 4                             |
| **Total**        | **20**  | **15**             | **5**                      | **20**                        |

- **First pass: 15 of 20 successful.** There were 5 transient provider errors and no misclassifications among the 15 responses.
- **Rerun: all 5 failed samples passed** when run once more.
- **Confidence:** almost always 0.95, including for the one-word input `ok`. This confirms that it's an AI-generated estimate, not a calibrated probability.
- **Scope:** these 20 hand-picked samples are a smoke test. They don't establish general model accuracy or production reliability.

After the per-attempt timeout was added, a smaller live check confirmed the change:

- A normal classification succeeded.
- With the per-attempt timeout forced to 50 ms, three real requests were cancelled and retried, and the call ended in `504 AI_REQUEST_TIMEOUT` after about 3.5 s.

The full 20-sample run wasn't repeated with the new settings.

Swagger UI was checked in headless Chrome with Helmet enabled:

- On `localhost` the page renders, `POST /api/v1/classify` is listed, and _Try it out → Execute_ returned `200` with a classification.
- After the docs-specific CSP change, the page also renders over plain HTTP on a LAN IP address.

## 9. Limitations and possible improvements

| Limitation                                                            | Production improvement                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Confidence isn't calibrated and has low variance (almost always 0.95) | Evaluate on a labelled dataset; calibrate or report accuracy per category |
| Depends on Gemini availability                                        | Optional fallback model or provider; circuit breaker                      |
| Live evaluation is a 20-sample smoke test, run once                   | Labelled evaluation set run against each model and prompt change          |
| A legitimately slow response (over 10 s) is cancelled and retried     | Tune `GEMINI_ATTEMPT_TIMEOUT_MS` using observed latency percentiles       |
| Swagger UI logs one CSP warning for an inline style                   | Accepted; adding `'unsafe-inline'` would weaken the docs CSP              |
| No authentication or rate limiting                                    | API keys or OAuth; `@fastify/rate-limit` to protect the AI quota          |
| Single label for mixed-intent text                                    | Multi-label output with per-category scores                               |
| Prompt injection can't be fully eliminated                            | Output constraints (already in place), monitoring, red-team test set      |
| Repeated identical texts cost one call each                           | Short-lived cache keyed by a hash of the normalised text                  |
