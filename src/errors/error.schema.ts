export const errorResponseSchema = {
  type: "object",
  required: ["success", "error", "requestId"],

  properties: {
    success: {
      type: "boolean",
      const: false
    },

    error: {
      type: "object",
      required: ["code", "message"],

      properties: {
        code: {
          type: "string"
        },

        message: {
          type: "string"
        },

        details: {}
      }
    },

    requestId: {
      type: "string"
    }
  }
} as const;
