import Fastify from "fastify";
import helmet from "@fastify/helmet";

import { env } from "./config/env.js";

import { errorHandler } from "./errors/error.handler.js";
import { notFoundHandler } from "./errors/not-found.handler.js";

import { GeminiProvider } from "./providers/gemini.provider.js";
import type { AIProvider } from "./providers/ai-provider.interface.js";

import { ClassificationService } from "./services/classification.service.js";
import { ClassificationController } from "./controllers/classification.controller.js";
import { registerClassificationRoutes } from "./routes/classification.route.js";

import { registerSwagger } from "./plugins/swagger.plugin.js";

export function buildApp(aiProvider: AIProvider = new GeminiProvider()) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie"]
    },

    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
        keywords: ["example"]
      }
    },

    bodyLimit: 16 * 1024,
    requestTimeout: 30000
  });

  // Security
  app.register(helmet);

  // Global error handling
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // Dependency injection
  const classificationService = new ClassificationService(aiProvider);

  const classificationController = new ClassificationController(
    classificationService
  );

  // Register documentation before API routes
  app.register(async (instance) => {
    await registerSwagger(instance);

    registerClassificationRoutes(instance, classificationController);
  });

  return app;
}
