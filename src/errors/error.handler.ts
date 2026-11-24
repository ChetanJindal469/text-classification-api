import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

import { AppError } from "./app.error.js";
import type { ApiErrorResponse } from "../types/api-response.type.js";

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  // Custom application errors
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      request.log.error({ err: error }, error.message);
    }

    const response: ApiErrorResponse = {
      success: false,
      error: {
        code: error.code,
        message: error.message
      },
      requestId: request.id
    };

    void reply.status(error.statusCode).send(response);
    return;
  }

  // Fastify schema validation errors
  if (error.validation) {
    const response: ApiErrorResponse = {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.validation.map((item) => {
          // Missing/extra properties are reported via params, not instancePath
          const property =
            item.params.missingProperty ?? item.params.additionalProperty;

          return {
            field:
              typeof property === "string"
                ? `${item.instancePath}/${property}`
                : item.instancePath,
            message: item.message
          };
        })
      },
      requestId: request.id
    };

    void reply.status(400).send(response);
    return;
  }

  // Other client-side HTTP errors
  const statusCode = error.statusCode ?? 500;

  if (statusCode >= 400 && statusCode < 500) {
    const response: ApiErrorResponse = {
      success: false,
      error: {
        code: error.code || "BAD_REQUEST",
        message: error.message
      },
      requestId: request.id
    };

    void reply.status(statusCode).send(response);
    return;
  }

  // Unexpected server errors
  request.log.error({ err: error }, "Unhandled application error");

  const response: ApiErrorResponse = {
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred"
    },
    requestId: request.id
  };

  void reply.status(500).send(response);
}
