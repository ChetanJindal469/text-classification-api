import { GeminiProvider } from "../src/providers/gemini.provider.js";

async function test(): Promise<void> {
  const provider = new GeminiProvider();

  const samples = [
    "My order has not arrived and nobody is responding.",
    "What is your return policy?",
    "Your customer support was excellent.",
    "The sky is blue."
  ];

  for (const text of samples) {
    const startTime = performance.now();

    const result = await provider.classify(text);

    console.log({
      text,
      ...result,
      responseTimeMs: Math.round(performance.now() - startTime)
    });
  }
}

test().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
