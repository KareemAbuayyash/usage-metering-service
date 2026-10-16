
import Fastify from "fastify";
import { pool } from "./db.js";
import { accountRoutes } from "./routes/accounts.js";
import { planRoutes } from "./routes/plans.js";
import { usageRoutes } from "./routes/usage.js";
import { usageReportRoutes } from "./routes/usage-reports.js";
import { userRoutes } from "./routes/users.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(accountRoutes);
  app.register(planRoutes);
  app.register(userRoutes);
  app.register(usageRoutes);
  app.register(usageReportRoutes);

  app.get("/health", async () => ({
    status: "ok",
    service: "usage-metering-service",
  }));

  app.get("/health/db", async (_request, reply) => {
    try {
      const result = await pool.query("SELECT NOW() AS database_time");

      return {
        status: "ok",
        database: "connected",
        databaseTime: result.rows[0].database_time,
      };
    } catch (error) {
      app.log.error(error);

      return reply.status(503).send({
        status: "error",
        database: "disconnected",
      });
    }
  });

  return app;
}

const start = async (): Promise<void> => {
  const app = buildApp();

  try {
    await app.listen({
      port: Number(process.env.PORT) || 3000,
      host: "0.0.0.0",
    });
  } catch (error) {
    app.log.error(error);
    await app.close();
    await pool.end();
    process.exitCode = 1;
  }
};

if (process.env.NODE_ENV !== "test") {
  void start();
}
