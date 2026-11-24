import type {} from "@fastify/swagger";
import type { FastifyInstance } from "fastify";

import type { ClassificationController } from "../controllers/classification.controller.js";

import type { ClassificationRequest } from "../types/classification.type.js";

import {
  classificationBodySchema,
  classificationResponseSchema
} from "../schemas/classification.schema.js";

import { errorResponseSchema } from "../schemas/error.schema.js";

export function registerClassificationRoutes(
  app: FastifyInstance,
  controller: ClassificationController
): void {
  app.post<{
    Body: ClassificationRequest;
  }>(
    "/api/v1/classify",
    {
      schema: {
        tags: ["Classification"],

        summary: "Classify input text using AI",

        description:
          "Classifies text into Complaint, Query, Feedback or Other using Google Gemini AI. The confidence score is an AI-generated estimate between 0 and 1.",

        body: classificationBodySchema,

        response: {
          200: {
            ...classificationResponseSchema,
            description: "Classification successful"
          },

          400: {
            ...errorResponseSchema,
            description: "Invalid request input"
          },

          413: {
            ...errorResponseSchema,
            description: "Request body too large"
          },

          500: {
            ...errorResponseSchema,
            description: "Internal server error"
          },

          502: {
            ...errorResponseSchema,
            description: "Invalid AI response"
          },

          503: {
            ...errorResponseSchema,
            description: "AI service unavailable"
          },

          504: {
            ...errorResponseSchema,
            description: "AI request timed out"
          }
        }
      }
    },
    controller.classify
  );
}
