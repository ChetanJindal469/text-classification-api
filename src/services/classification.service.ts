import type { AIProvider } from "../providers/ai-provider.interface.js";

import type { ClassificationResult } from "../types/classification.type.js";

export class ClassificationService {
  constructor(private readonly aiProvider: AIProvider) {}

  async classify(text: string): Promise<ClassificationResult> {
    return this.aiProvider.classify(text.trim());
  }
}
