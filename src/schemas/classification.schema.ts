import { z } from "zod";

export const CLASSIFICATION_CATEGORIES = [
  "Complaint",
  "Query",
  "Feedback",
  "Other"
] as const;

// Runtime validation of AI-generated responses
export const classificationResultSchema = z
  .object({
    category: z.enum(CLASSIFICATION_CATEGORIES),
    confidence: z.number().min(0).max(1)
  })
  .strict();

export type ClassificationResult = z.infer<typeof classificationResultSchema>;

// HTTP request validation
export const classificationBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: {
      type: "string",
      minLength: 1,
      maxLength: 5000,
      pattern: "\\S",
      description: "Text to be classified by the AI model",
      example: "My order has not arrived yet."
    }
  }
} as const;

// Gemini structured output schema
export const aiResponseSchema = {
  type: "object",
  required: ["category", "confidence"],
  properties: {
    category: {
      type: "string",
      enum: [...CLASSIFICATION_CATEGORIES]
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    }
  }
} as const;

// HTTP success response schema
export const classificationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["success", "data"],
  properties: {
    success: {
      type: "boolean",
      const: true,
      example: true
    },
    data: {
      ...aiResponseSchema,
      additionalProperties: false,
      properties: {
        category: {
          ...aiResponseSchema.properties.category,
          description: "Predicted classification category",
          example: "Complaint"
        },
        confidence: {
          ...aiResponseSchema.properties.confidence,
          description: "AI-generated confidence estimate between 0 and 1",
          example: 0.99
        }
      }
    }
  }
} as const;
