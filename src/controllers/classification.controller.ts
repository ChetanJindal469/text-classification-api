import type { FastifyRequest, FastifyReply } from "fastify";

import type { ClassificationService } from "../services/classification.service.js";

import type {
  ClassificationRequest,
  ClassificationResult
} from "../types/classification.type.js";

import type { ApiSuccessResponse } from "../types/api-response.type.js";

export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  classify = async (
    request: FastifyRequest<{
      Body: ClassificationRequest;
    }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { text } = request.body;

    const startTime = performance.now();

    const result = await this.classificationService.classify(text);

    const responseTimeMs = Math.round(performance.now() - startTime);

    request.log.info(
      {
        category: result.category,
        confidence: result.confidence,
        responseTimeMs
      },
      "Text classification completed"
    );

    const response: ApiSuccessResponse<ClassificationResult> = {
      success: true,
      data: result
    };

    await reply.status(200).send(response);
  };
}
