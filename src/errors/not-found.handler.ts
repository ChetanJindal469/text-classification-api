import type { FastifyRequest, FastifyReply } from "fastify";

import type { ApiErrorResponse } from "../types/api-response.type.js";

export function notFoundHandler(
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `Route ${request.method} ${request.url} not found`
    },
    requestId: request.id
  };

  void reply.status(404).send(response);
}
