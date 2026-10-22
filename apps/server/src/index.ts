import { config } from "./config.js";
import { connectDatabase } from "./database.js";
import { initializeDatabase } from "../../../database/schema.js";
import { createApp } from "./app.js";
const cfg = config(),
  d = await connectDatabase(cfg.uri);
await initializeDatabase(d.db);
const server = createApp(d, cfg).listen(cfg.port, cfg.host, () =>
  console.log(`问笺服务已启动：http://${cfg.host}:${cfg.port}`),
);
const stop = () =>
  server.close(() => {
    void d.client.close().then(() => process.exit(0));
  });
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
