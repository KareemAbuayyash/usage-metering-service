import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "../db.js";

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(150),
  plan: z.enum(["Basic", "Premium"]).default("Basic"),
});

export async function userRoutes(app: FastifyInstance) {
  app.get("/users", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];

    if (typeof apiKey !== "string" || apiKey.length === 0) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing API key.",
      });
    }

    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
    const accountResult = await pool.query(
      "SELECT id FROM accounts WHERE api_key_hash = $1",
      [apiKeyHash],
    );

    if (accountResult.rowCount !== 1) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Invalid API key.",
      });
    }

    const accountId = accountResult.rows[0].id;
    const now = new Date();
    const monthStart = `${now.getUTCFullYear()}-${String(
      now.getUTCMonth() + 1,
    ).padStart(2, "0")}-01`;
    const result = await pool.query(
      `SELECT u.id, u.name, p.name AS plan_name, p.monthly_limit,
              u.created_at, COALESCE(up.consumed_units, 0)::text AS consumed
       FROM users u
       JOIN plans p ON p.id = u.plan_id AND p.scope = 'user'
       LEFT JOIN usage_periods up
         ON up.account_id = u.account_id
        AND up.user_id = u.id
        AND up.month_start = $2
       WHERE u.account_id = $1
       ORDER BY u.created_at DESC, u.id`,
      [accountId, monthStart],
    );

    return {
      users: result.rows.map((user) => {
        const consumed = BigInt(user.consumed);
        const limit = BigInt(user.monthly_limit);

        return {
          id: user.id,
          accountId,
          name: user.name,
          plan: user.plan_name,
          createdAt: user.created_at,
          usage: {
            monthStart,
            consumed: consumed.toString(),
            limit: limit.toString(),
            remaining: (limit > consumed ? limit - consumed : 0n).toString(),
          },
        };
      }),
    };
  });

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
