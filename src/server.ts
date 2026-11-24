import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = buildApp();

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;

  isShuttingDown = true;

  app.log.info({ signal }, "Graceful shutdown initiated");

  try {
    await app.close();

    app.log.info("Server closed successfully");

    process.exitCode = 0;
  } catch (error) {
    app.log.error({ err: error }, "Shutdown failed");

    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function start(): Promise<void> {
  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT
    });
  } catch (error) {
    app.log.error({ err: error }, "Server startup failed");

    process.exit(1);
  }
}

void start();
