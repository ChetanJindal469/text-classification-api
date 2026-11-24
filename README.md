# AI Text Classification API

A REST API that classifies a piece of text as **Complaint**, **Query**, **Feedback** or **Other** using Google Gemini, and returns the category with a confidence score.

Built with Node.js 24, Fastify 5, TypeScript (strict), Zod and the official `@google/genai` SDK.

## Contents

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [API](#api)
- [Error codes](#error-codes)
- [Architecture](#architecture)
- [AI integration](#ai-integration)
- [Testing](#testing)
- [Postman collection](#postman-collection)
- [Security](#security)
- [Known limitations](#known-limitations)

## Quick start

Prerequisites: Node.js 24 or later, npm, and a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

```bash
git clone <repository-url>
cd text-classification-api
npm ci                    # installs the exact versions in package-lock.json

cp .env.example .env      # PowerShell: Copy-Item .env.example .env
# Edit .env and set GEMINI_API_KEY. The server refuses to start without it.

npm run dev               # http://localhost:4000
```

To check the setup without an API key, run `npm test`. The automated tests use a mocked AI provider and don't read `GEMINI_API_KEY` from `.env`.

Interactive API documentation (Swagger UI) is served at **http://localhost:4000/docs**, and the OpenAPI specification at `/docs/json`.

Production build:

```bash
npm run build
npm start
```

### Scripts

| Script                 | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Start with hot reload (`tsx watch`)        |
| `npm run build`        | Compile TypeScript to `dist/`              |
| `npm start`            | Run the compiled server                    |
| `npm test`             | Run all tests once (Vitest)                |
| `npm run typecheck`    | Type-check source, tests and scripts       |
| `npm run lint`         | ESLint                                     |
| `npm run format:check` | Prettier check (`npm run format` to apply) |

`scripts/test-gemini.ts` is an optional manual smoke test against the real Gemini API, using your `.env`: `npx tsx scripts/test-gemini.ts`. It sends 20 samples (the four categories, ambiguous messages, Hindi, Bengali, mixed-language text and prompt-injection attempts). It prints the expected and actual category, confidence, response time and PASS/FAIL/ERROR for each one, continues after failed samples, and stops after three consecutive provider errors so that an outage doesn't use up quota.

## Configuration

All configuration comes from environment variables, validated with Zod at startup. The server refuses to start if a value is missing or invalid.

| Variable                    | Required | Default       | Description                                                                                                                |
| --------------------------- | -------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`            | Yes      | –             | Gemini API key. Never commit it; `.env` is git-ignored.                                                                    |
| `GEMINI_MODEL`              | Yes      | –             | Gemini model ID, e.g. `gemini-3.5-flash-lite`.                                                                             |
| `GEMINI_TIMEOUT_MS`         | No       | `15000`       | Total time budget per classification, **including all attempts and backoff**. `.env.example` sets the recommended `30000`. |
| `GEMINI_ATTEMPT_TIMEOUT_MS` | No       | `10000`       | Maximum duration of a single Gemini attempt. A timed-out attempt is retried while the overall budget has time left.        |
| `GEMINI_MAX_RETRIES`        | No       | `2`           | Retries for transient 5xx errors and attempt timeouts (0–5).                                                               |
| `GEMINI_RETRY_DELAY_MS`     | No       | `1000`        | Initial backoff delay; doubles on each retry, plus up to 250 ms jitter.                                                    |
| `PORT`                      | No       | `4000`        | HTTP port.                                                                                                                 |
| `HOST`                      | No       | `0.0.0.0`     | HTTP host.                                                                                                                 |
| `LOG_LEVEL`                 | No       | `info`        | Pino log level (`fatal` … `trace`, `silent`).                                                                              |
| `NODE_ENV`                  | No       | `development` | `development`, `production` or `test`.                                                                                     |

Fastify's `requestTimeout` (30 s) limits only how long the server waits to _receive_ a request. It doesn't cut off a running handler, so it doesn't conflict with a 30 s Gemini budget.

## API

### `POST /api/v1/classify`

**Request**

```http
POST /api/v1/classify
Content-Type: application/json

{ "text": "My order has not arrived yet." }
```

Validation rules:

- The body must be a JSON object with exactly one property, `text`. Unknown properties are rejected.
- `text` must be a string of 1–5000 characters containing at least one non-whitespace character. No type coercion is applied, so `123` is rejected.
- The request body is limited to 16 KB.
- Leading and trailing whitespace is trimmed before classification.

**Success response: `200 OK`**

```json
{
  "success": true,
  "data": {
    "category": "Complaint",
    "confidence": 0.95
  }
}
```

`confidence` is a number between 0 and 1 produced by the model. See [Known limitations](#known-limitations).

**Error response** (all errors use this shape)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "/text", "message": "must have required property 'text'" }
    ]
  },
  "requestId": "req-1"
}
```

`details` is present only for validation errors. `requestId` matches the `reqId` in the server logs.

### Examples

curl (macOS, Linux, Git Bash):

```bash
curl -X POST http://localhost:4000/api/v1/classify \
  -H "Content-Type: application/json" \
  -d '{"text": "What is your return policy?"}'
```

PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/v1/classify `
  -ContentType "application/json" `
  -Body '{"text": "Your support team was excellent."}'
```

| Input                                                | Expected category |
| ---------------------------------------------------- | ----------------- |
| `My order has not arrived and nobody is responding.` | Complaint         |
| `What is your return policy?`                        | Query             |
| `Your customer support was excellent.`               | Feedback          |
| `The sky is blue.`                                   | Other             |

The model decides the category, so results for ambiguous text can vary.

## Error codes

| HTTP | Code                             | When                                                                                   |
| ---- | -------------------------------- | -------------------------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`               | Body fails schema validation (missing/empty/non-string `text`, extra fields, too long) |
| 400  | `FST_ERR_CTP_INVALID_JSON_BODY`  | Body is not valid JSON                                                                 |
| 404  | `ROUTE_NOT_FOUND`                | Unknown route or method                                                                |
| 413  | `FST_ERR_CTP_BODY_TOO_LARGE`     | Body larger than 16 KB                                                                 |
| 415  | `FST_ERR_CTP_INVALID_MEDIA_TYPE` | Unsupported `Content-Type` (use `application/json`)                                    |
| 500  | `INTERNAL_SERVER_ERROR`          | Unexpected error. Details are logged, never returned.                                  |
| 502  | `INVALID_AI_RESPONSE`            | Model returned empty, non-JSON or schema-invalid output                                |
| 502  | `AI_CONFIGURATION_ERROR`         | Gemini rejected the request (400/401/403/404), e.g. invalid key or model               |
| 503  | `AI_SERVICE_UNAVAILABLE`         | Gemini 5xx or network error that persisted after retries                               |
| 503  | `AI_RATE_LIMIT_EXCEEDED`         | Gemini returned 429 (rate limit or quota)                                              |
| 504  | `AI_REQUEST_TIMEOUT`             | Classification did not finish within `GEMINI_TIMEOUT_MS`                               |

When the AI call fails, the API returns an error. It never returns a default or guessed classification.

## Architecture

```text
HTTP request
   │
   ▼
Fastify ── JSON schema validation (AJV) ── 400/413/415 on failure
   │
   ▼
Route (routes/)            → registers POST /api/v1/classify with request/response schemas
   │
   ▼
Controller (controllers/)  → reads the body, calls the service, shapes the success response
   │
   ▼
Service (services/)        → business logic (input normalisation)
   │
   ▼
AIProvider interface       → GeminiProvider (providers/)
                               prompt, structured output, timeout, retry, output validation,
                               maps provider failures to AppError
   │
   ▼
Error handler (errors/)    → one consistent error shape for every failure
```

```text
src/
├── app.ts                  Fastify setup, plugins, dependency wiring (buildApp)
├── server.ts               Process entry point, listen, graceful shutdown
├── config/env.ts           Zod-validated environment
├── routes/                 Route registration and OpenAPI metadata
├── controllers/            HTTP layer
├── services/               Business layer
├── providers/              AIProvider interface and Gemini implementation
├── prompts/                System prompt and user-message builder
├── schemas/                Request/response JSON schemas, Zod schema for AI output
├── errors/                 AppError, error handler, 404 handler
├── plugins/                Swagger / Swagger UI
├── types/                  Shared types
└── utils/retry.util.ts     Exponential backoff with jitter, abort-aware
tests/                      Unit and integration tests (Vitest)
postman/                    Postman collection
```

`buildApp(aiProvider)` accepts any `AIProvider`. Production uses `GeminiProvider`; tests pass a mock. Adding another model provider means writing one class that implements `classify(text)`.

## AI integration

### Request to Gemini

`GeminiProvider` calls `models.generateContent` with:

- **System instruction**: the classification rules (`src/prompts/classification.prompt.ts`).
- **User content**: the input text JSON-encoded as `{"text": "..."}`.
- **Structured output**: `responseMimeType: "application/json"` and a JSON schema that limits `category` to the four values and `confidence` to 0–1.
- **`temperature: 0.1`** for more consistent classifications.
- **`abortSignal`** to enforce the timeout.

The model is chosen through `GEMINI_MODEL`, so you can switch models without changing code.

### Prompt design

- Each category has a definition, plus tie-break rules: choose the dominant intent; a question that mainly expresses dissatisfaction is a Complaint; a constructive suggestion that reports no failure is Feedback.
- **Prompt-injection mitigation**: rules live in the system instruction. User text is sent only as a JSON string value, and the prompt tells the model to treat it as untrusted data and never follow instructions inside it. Even if the model is manipulated, the output schema and validation below limit the response to one of the four categories.
- **Confidence guidance**: 0.9–1.0 for clear intent, 0.6–0.89 for overlapping intent, below 0.6 for ambiguous or very short text. This makes scores more consistent; it does not calibrate them.

### Output validation

Structured output is a strong hint, not a guarantee. Every response is:

1. Checked for empty text → `502 INVALID_AI_RESPONSE`
2. Parsed with `JSON.parse` → `502` if invalid
3. Validated with a strict Zod schema (exact category names, number in 0–1, no extra properties) → `502` if invalid

Only a validated result reaches the client.

### Timeout and retry strategy

- **Overall deadline**: one `AbortSignal.timeout(GEMINI_TIMEOUT_MS)` covers the whole operation, including all attempts and backoff waits. The AI call never takes longer than this budget, which keeps latency predictable for API clients.
- **Per-attempt timeout**: each attempt also gets its own `AbortSignal.timeout(GEMINI_ATTEMPT_TIMEOUT_MS)`, combined with the overall deadline through `AbortSignal.any`. A slow or hung attempt is cancelled and retried, as long as the overall deadline has time left. This matters because Gemini's 503 responses were measured arriving after 13–20 s (see [Model selection notes](#model-selection-notes)). With the recommended settings (30 s overall, 10 s per attempt, 2 retries) a slow failure no longer uses up the whole budget.
- **Retries**: transient errors (HTTP 500, 502, 503, 504) and per-attempt timeouts are retried, up to `GEMINI_MAX_RETRIES` times, with exponential backoff (`delay × 2^attempt`) plus random jitter. The backoff wait is cancelled as soon as the overall deadline expires. Both a final attempt timeout and the overall deadline return `504 AI_REQUEST_TIMEOUT`.
- **Not retried**: 429 (retrying usually makes rate limiting worse), 4xx configuration errors, malformed AI output, and network errors.
- **Single retry layer**: `@google/genai` can retry by itself, but only when `httpOptions.retryOptions` is configured. In SDK 3.6.1 it is off by default (`apiCall` skips p-retry when `retryOptions` is undefined). This client doesn't set it, so each classification makes at most `1 + GEMINI_MAX_RETRIES` HTTP calls. Configuring both would multiply attempts (up to 5 × 3 = 15 calls), so use one layer only.
- **Diagnostics**: provider failures are logged with sanitized metadata only: the application error code, the HTTP status, the provider's HTTP status and the upstream error type, for example `{"code":"AI_CONFIGURATION_ERROR","statusCode":502,"metadata":{"providerStatus":404,"providerErrorType":"ApiError"}}`. The upstream error message isn't kept, because it can contain arbitrary provider response bodies. The client receives only a generic message.

### Model selection notes

Observed during development (results are time- and account-dependent):

| Model                   | Observation                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `gemini-2.5-flash-lite` | No longer available to new users                                                                                      |
| `gemini-3.5-flash-lite` | Default documented model. Smoke test: 15/20 succeeded on the first pass, with 5 transient provider errors (see below) |
| `gemini-3.1-flash-lite` | Classified three of four early samples; one request timed out                                                         |

#### Live Gemini evaluation (manual, separate from the automated tests)

`scripts/test-gemini.ts` was run once against the real API with `gemini-3.5-flash-lite` on 25 November 2026, using a 15 s overall budget and no per-attempt timeout:

| Group            | Samples | Correct (1st pass) | Provider errors (1st pass) | Correct after rerun of errors |
| ---------------- | ------- | ------------------ | -------------------------- | ----------------------------- |
| Four categories  | 4       | 3                  | 1 (503 after retries)      | 4                             |
| Ambiguous        | 5       | 5                  | 0                          | 5                             |
| Hindi            | 2       | 2                  | 0                          | 2                             |
| Bengali          | 2       | 1                  | 1 (504 timeout)            | 2                             |
| Mixed language   | 3       | 3                  | 0                          | 3                             |
| Prompt injection | 4       | 1                  | 3 (504 timeout)            | 4                             |
| **Total**        | **20**  | **15**             | **5**                      | **20**                        |

- **First pass: 15/20 successful**, with 5 transient provider errors and no misclassifications among the 15 responses.
- The 5 failed samples were **run once more and all 5 passed**.
- Successful calls typically took 1–2 seconds.
- Two ambiguous samples accept either of two categories. The injection samples cover overriding instructions, a fake system message, a JSON break-out attempt and an off-task instruction.
- These 20 hand-picked samples are a smoke test, not an accuracy benchmark. They don't show general model accuracy.

Findings:

- **HTTP 503 responses from Gemini are slow.** A direct probe measured 503 responses arriving after 13.6 s and 19.9 s. With a 15 s budget and no per-attempt timeout, a slow 503 surfaced as `504 AI_REQUEST_TIMEOUT` with no time left to retry. This led to the per-attempt timeout and the recommended 30 s overall budget. The per-attempt timeout is covered by automated tests and a live forced-timeout check, but the 20-sample smoke test hasn't been rerun with the new settings.
- **Thinking configuration.** The model supports thinking, but with the current settings it used 0 thinking tokens. `thinkingLevel: MINIMAL` was accepted but made no measurable difference to latency. `thinkingBudget: 0` is rejected with HTTP 400. No thinking configuration is set, so the request stays model-agnostic.
- **Confidence has low variance.** Almost every response reported 0.95, including the one-word input `ok`, even though the prompt asks for a lower score on very short text.

Retries with backoff reduce, but can't eliminate, capacity failures. Automatic fallback to a second model was deliberately not implemented: it would add configuration and make the result depend on which model answered, which isn't justified for this scope.

## Testing

```bash
npm test
```

**66 automated tests, all passing.** They are deterministic and **never call Gemini**: the SDK is mocked with `vi.mock`, and HTTP tests inject a mock `AIProvider` and use Fastify `inject()`, so no port is opened. Test configuration is set in `vitest.config.ts` and takes precedence over `.env`. The automated tests check the service's behaviour, not the model's classification quality; that was checked separately in the [live Gemini evaluation](#live-gemini-evaluation-manual-separate-from-the-automated-tests).

| File                                    | Covers                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/classification.api.test.ts` (29) | Success response; trimming; 5000-char boundary; all validation failures; malformed JSON; 413; 415; provider error mapping; generic 500 without leaks; 404; OpenAPI spec; Swagger UI and its docs-only CSP; security headers                                                                                                                      |
| `tests/gemini.provider.test.ts` (31)    | Request sent to the SDK (model, schema, system prompt, abort signal); prompt-injection text sent as data; 12 malformed-output cases; retry then success; retries exhausted; 429; 4xx config errors; network errors; sanitized error metadata; overall deadline; deadline across retries; per-attempt timeout with retry; all attempts timing out |
| `tests/retry.util.test.ts` (6)          | Success, retry, exhaustion, non-retryable errors, abort during backoff, pre-aborted signal                                                                                                                                                                                                                                                       |

## Postman collection

Import `postman/text-classification-api.postman_collection.json`. The `baseUrl` variable defaults to `http://localhost:4000`. The collection has one example per category plus the validation and routing error cases, each with test scripts. The four category requests call the real Gemini API, so they need a valid key and their category check is informational.

## Security

- The API key is read only from the environment. `.env` is git-ignored, and only `.env.example` (without a key) is committed.
- Request bodies, input text and request headers aren't logged. Request logs contain method, URL, host and remote address. As an extra safeguard, the `authorization` and `cookie` headers are redacted if they're ever logged.
- Error responses for 5xx failures contain a generic message. Server logs record only sanitized metadata for provider failures: error code, HTTP status, provider status and error type. Upstream response bodies aren't logged. This was checked with real Gemini errors (invalid model and invalid key) at `trace` log level. The logs contained no API key, request headers, submitted text or upstream error body.
- Strict input validation: no type coercion, no extra properties, size limits on the field and the body.
- Helmet sets security headers globally, including a content security policy. Only the Swagger UI routes (`/docs`) use their own, documentation-specific CSP. It restricts scripts to the same origin but leaves out `upgrade-insecure-requests`, so the docs also load over plain HTTP on non-localhost hosts (verified in headless Chrome).

## Known limitations

- **Confidence is not a calibrated probability.** The model generates it as part of its answer, and a value of 0.9 doesn't mean the answer is right 90% of the time. With `gemini-3.5-flash-lite` it was almost always 0.95, so it says little about how ambiguous an input is. Calibration would need a labelled evaluation dataset.
- **Confidence scores are AI-generated estimates.** They aren't statistically calibrated probabilities and shouldn't be used as such.
- **Live evaluation is small.** It covers 20 hand-picked samples, run once. It's a smoke test, not a measure of general accuracy or production reliability.
- **Per-attempt timeout trade-off.** A legitimately slow response that takes longer than `GEMINI_ATTEMPT_TIMEOUT_MS` (10 s) is cancelled and retried. Successful calls observed so far took 1–4 s.
- **Swagger UI CSP warning.** The docs CSP doesn't allow inline styles, so the browser logs one CSP warning for an inline style. The page renders and works; `'unsafe-inline'` was deliberately not added.
- **Non-determinism**: even at low temperature, the same text can occasionally receive a different category or confidence, especially for ambiguous input.
- **Availability depends on Gemini**: capacity-related 503 errors and quota limits pass through as 503 after retries. There's no fallback model, cache or queue.
- **No authentication or rate limiting** on this API. A public deployment would need both to protect the Gemini quota.
- **Single-label output**: mixed-intent text such as "Great product, but where is my refund?" gets only the dominant category.
- **Prompt injection** is mitigated (data/instruction separation and a constrained output schema) but can't be fully eliminated with LLMs.
