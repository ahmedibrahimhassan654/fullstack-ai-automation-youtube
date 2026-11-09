import { connectDB } from "./config/db.js";
import { validateEnv } from "./config/env.js";
import app from "./app.js";
import { env } from "./config/env.js";
import { resumeStuckVideoPipelines } from "./controllers/video.controller.js";

validateEnv();

const start = async () => {
  await connectDB();

  const server = app.listen(env.port, () => {
    console.log(`[server] Running in ${env.nodeEnv} mode on port ${env.port}`);

    process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));
    process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));

    // Auto-resume can make long AI jobs block the dev server; keep it opt-in.
    if (process.env.ENABLE_STARTUP_RESUME === "1") {
      setImmediate(() => {
        resumeStuckVideoPipelines().catch((err) =>
          console.error("[server] resumeStuckVideoPipelines failed:", err?.message || err),
        );
      });
    } else {
      console.log("[server] startup auto-resume disabled");
    }
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, shutting down gracefully`);
    server.close(() => {
      console.log("[server] HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

start().catch((err) => {
  console.error("[server] Failed to start:", err);
  process.exit(1);
});
