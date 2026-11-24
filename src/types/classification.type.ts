import type {
  CLASSIFICATION_CATEGORIES,
  ClassificationResult
} from "../schemas/classification.schema.js";

export type ClassificationCategory = (typeof CLASSIFICATION_CATEGORIES)[number];

export interface ClassificationRequest {
  text: string;
}

export type { ClassificationResult };
