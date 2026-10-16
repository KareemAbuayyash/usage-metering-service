import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "../db.js";

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(150),
  plan: z.enum(["Basic", "Premium"]).default("Basic"),
});

export async function userRoutes(app: FastifyInstance) {
  app.post("/users", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];

    if (typeof apiKey !== "string" || apiKey.length === 0) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing API key.",
      });
    }

    const parsed = createUserSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const accountResult = await client.query(
        `SELECT id
         FROM accounts
         WHERE api_key_hash = $1
         FOR UPDATE`,
        [apiKeyHash],
      );

      if (accountResult.rowCount !== 1) {
        await client.query("ROLLBACK");

        return reply.code(401).send({
          error: "UNAUTHORIZED",
          message: "Invalid API key.",
        });
      }

      const accountId = accountResult.rows[0].id;
      const { name, plan } = parsed.data;

      const planResult = await client.query(
        `SELECT id
         FROM plans
         WHERE scope = 'user'
           AND name = $1
           AND is_builtin = TRUE`,
        [plan],
      );

      if (planResult.rowCount !== 1) {
        await client.query("ROLLBACK");

        return reply.code(500).send({
          error: "PLAN_NOT_FOUND",
          message: "The requested user plan is unavailable.",
        });
      }

      const userResult = await client.query(
        `INSERT INTO users (account_id, name, plan_id)
         VALUES ($1, $2, $3)
         RETURNING id, account_id, name, created_at`,
        [accountId, name, planResult.rows[0].id],
      );

      await client.query("COMMIT");

      return reply.code(201).send({
        id: userResult.rows[0].id,
        accountId: userResult.rows[0].account_id,
        name: userResult.rows[0].name,
        plan,
        createdAt: userResult.rows[0].created_at,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      app.log.error(error);

      return reply.code(500).send({
        error: "INTERNAL_SERVER_ERROR",
        message: "Could not create the user.",
      });
    } finally {
      client.release();
    }
  });
}
