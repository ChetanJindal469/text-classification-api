export const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["success", "error", "requestId"],
  properties: {
    success: {
      type: "boolean",
      const: false,
      example: false
    },
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message"],
      properties: {
        code: {
          type: "string",
          example: "VALIDATION_ERROR"
        },
        message: {
          type: "string",
          example: "Request validation failed"
        },
        details: {}
      }
    },
    requestId: {
      type: "string",
      example: "req-1"
    }
  }
} as const;
