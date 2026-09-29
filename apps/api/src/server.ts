import { buildApp } from "./app.js";

const app = await buildApp();
const port = Number(process.env.API_PORT ?? 4000);
const shutdown = async (signal: string) => { app.log.info({ signal }, "graceful shutdown"); await app.close(); process.exit(0); };
process.on("SIGTERM", () => void shutdown("SIGTERM")); process.on("SIGINT", () => void shutdown("SIGINT"));
await app.listen({ host: "0.0.0.0", port });
