import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",

      info: {
        title: "AI Text Classification API",
        description:
          "AI-powered text classification using Fastify, TypeScript and Google Gemini.",
        version: "1.0.0",
        contact: {
          name: "Chetan Jindal",
          url: "https://chetandev.in"
        }
      },

      tags: [
        {
          name: "Classification",
          description: "AI-powered text classification"
        }
      ]
    }
  });

  await app.register(swaggerUI, {
    routePrefix: "/docs",

    uiConfig: {
      docExpansion: "list",
      deepLinking: true
    },

    staticCSP: true
  });
}
