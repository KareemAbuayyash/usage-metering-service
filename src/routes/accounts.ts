import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

const createAccountSchema = z.object({
  name: z.string().trim().min(2).max(150),
  plan: z.enum(["Starter", "Pro"]).default("Starter"),
});

export async function accountRoutes(app: FastifyInstance) {
  app.post("/accounts", async (request, reply) => {
    const parsed = createAccountSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: "Provide a valid account name and plan.",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { name, plan } = parsed.data;

    // Generate a secret API key and hash it before storage.
    const apiKey = `ums_${randomBytes(32).toString("hex")}`;

    const apiKeyHash = createHash("sha256")
      .update(apiKey)
      .digest("hex");

    try {
      const result = await pool.query(
        `INSERT INTO accounts (name, api_key_hash, account_plan_id)
         SELECT $1, $2, p.id
         FROM plans p
         WHERE p.scope = 'account'
           AND p.name = $3
           AND p.is_builtin = TRUE
         RETURNING id, name, created_at`,
        [name, apiKeyHash, plan],
      );

      if (result.rowCount !== 1) {
        app.log.error({ plan }, "Built-in account plan was not found");

        return reply.code(500).send({
          error: "PLAN_NOT_FOUND",
          message: "The requested account plan is unavailable.",
        });
      }

      const account = result.rows[0];

      return reply.code(201).send({
        id: account.id,
        name: account.name,
        plan,
        apiKey,
        createdAt: account.created_at,
        warning: "Save this API key securely. It will not be shown again.",
      });
    } catch (error) {
      app.log.error(error);

      return reply.code(500).send({
        error: "INTERNAL_SERVER_ERROR",
        message: "Could not create the account.",
      });
    }
  });
}
