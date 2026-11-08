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
    // Resume any videos left processing by a previous instance.
    resumeStuckVideoPipelines().catch((err) =>
      console.error("[server] resumeStuckVideoPipelines failed:", err?.message || err),
    );
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
