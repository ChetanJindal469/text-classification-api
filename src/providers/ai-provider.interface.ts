import type { ClassificationResult } from "../types/classification.type.js";

export interface AIProvider {
  classify(text: string): Promise<ClassificationResult>;
}
