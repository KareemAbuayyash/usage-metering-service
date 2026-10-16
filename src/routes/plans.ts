import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db.js";

const planIdSchema = z.object({
  planId: z.string().uuid(),
});

const createPlanSchema = z.object({
  scope: z.enum(["account", "user"]),
  name: z.string().trim().min(2).max(100),
  monthlyLimit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxUnitsPerRequest: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const updatePlanSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  monthlyLimit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  maxUnitsPerRequest: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).refine((data) => Object.values(data).some((value) => value !== undefined), {
  message: "Provide at least one field to update.",
});

const assignAccountSchema = z.object({
  planId: z.string().uuid(),
});

const assignUserSchema = z.object({
  userId: z.string().uuid(),
  planId: z.string().uuid(),
});

async function authenticate(apiKey: unknown): Promise<string | null> {
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    return null;
  }

  const hash = createHash("sha256").update(apiKey).digest("hex");

  const result = await pool.query(
    "SELECT id FROM accounts WHERE api_key_hash = $1",
    [hash],
  );

  return result.rows[0]?.id ?? null;
}

async function lockAccount(client: PoolClient, accountId: string): Promise<void> {
  await client.query(
    "SELECT id FROM accounts WHERE id = $1 FOR UPDATE",
    [accountId],
  );
}

function validationError(
  reply: FastifyReply,
  issues: z.ZodError["issues"],
) {
  return reply.code(400).send({
    error: "VALIDATION_ERROR",
    details: issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    })),
  });
}

async function rollbackTransaction(
  client: PoolClient,
  app: FastifyInstance,
): Promise<boolean> {
  try {
    await client.query("ROLLBACK");
    return true;
  } catch (error) {
    app.log.error(error, "Could not roll back the plan transaction");
    return false;
  }
}

export async function planRoutes(app: FastifyInstance) {
  // List built-in plans and this account's custom plans.
  app.get("/plans", async (request, reply) => {
    const accountId = await authenticate(request.headers["x-api-key"]);

    if (!accountId) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing or invalid API key.",
      });
    }

    const result = await pool.query(
      `SELECT id, scope, name, monthly_limit, max_units_per_request,
              is_builtin, created_at, updated_at
       FROM plans
       WHERE is_builtin = TRUE OR owner_account_id = $1
       ORDER BY scope, name`,
      [accountId],
    );

    return { plans: result.rows };
  });

  // Create an account-owned custom plan.
  app.post("/plans", async (request, reply) => {
    const accountId = await authenticate(request.headers["x-api-key"]);

    if (!accountId) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing or invalid API key.",
      });
    }

    const parsed = createPlanSchema.safeParse(request.body);

    if (!parsed.success) {
      return validationError(reply, parsed.error.issues);
    }

    const { scope, name, monthlyLimit, maxUnitsPerRequest } = parsed.data;
    const client = await pool.connect();
    let inTransaction = false;

    try {
      await client.query("BEGIN");
      inTransaction = true;
      await lockAccount(client, accountId);

      const result = await client.query(
        `INSERT INTO plans
           (owner_account_id, scope, name, monthly_limit, max_units_per_request)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, scope, name, monthly_limit, max_units_per_request,
                   is_builtin, created_at, updated_at`,
        [accountId, scope, name, monthlyLimit, maxUnitsPerRequest],
      );

      await client.query("COMMIT");
      inTransaction = false;

      return reply.code(201).send({ plan: result.rows[0] });
    } catch (error) {
      if (inTransaction && await rollbackTransaction(client, app)) {
        inTransaction = false;
      }
      app.log.error(error);
      return reply.code(500).send({
        error: "INTERNAL_SERVER_ERROR",
        message: "Could not create the plan.",
      });
    } finally {
      client.release(inTransaction);
    }
  });

  // Get a built-in plan or a custom plan owned by this account.
  app.get("/plans/:planId", async (request, reply) => {
    const accountId = await authenticate(request.headers["x-api-key"]);

    if (!accountId) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing or invalid API key.",
      });
    }

    const params = planIdSchema.safeParse(request.params);

    if (!params.success) {
      return validationError(reply, params.error.issues);
    }

    const result = await pool.query(
      `SELECT id, scope, name, monthly_limit, max_units_per_request,
              is_builtin, created_at, updated_at
       FROM plans
       WHERE id = $1
         AND (is_builtin = TRUE OR owner_account_id = $2)`,
      [params.data.planId, accountId],
    );

    if (result.rowCount !== 1) {
      return reply.code(404).send({
        error: "PLAN_NOT_FOUND",
        message: "Plan not found.",
      });
    }

    return { plan: result.rows[0] };
  });

  // Update only custom plans owned by this account.
  app.patch("/plans/:planId", async (request, reply) => {
    const accountId = await authenticate(request.headers["x-api-key"]);

    if (!accountId) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing or invalid API key.",
      });
    }

    const params = planIdSchema.safeParse(request.params);
    const parsed = updatePlanSchema.safeParse(request.body);

    if (!params.success) return validationError(reply, params.error.issues);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const client = await pool.connect();
    let inTransaction = false;

    try {
      await client.query("BEGIN");
      inTransaction = true;
      await lockAccount(client, accountId);

      const existing = await client.query(
        `SELECT id, is_builtin
         FROM plans
         WHERE id = $1
           AND (is_builtin = TRUE OR owner_account_id = $2)
         FOR UPDATE`,
        [params.data.planId, accountId],
      );

      if (existing.rowCount !== 1) {
        await client.query("ROLLBACK");
        inTransaction = false;
        return reply.code(404).send({
          error: "PLAN_NOT_FOUND",
          message: "Plan not found.",
        });
      }

      if (existing.rows[0].is_builtin) {
        await client.query("ROLLBACK");
        inTransaction = false;
        return reply.code(403).send({
          error: "BUILTIN_PLAN_READ_ONLY",
          message: "Built-in plans cannot be modified.",
        });
      }

      const fields = parsed.data;
      const assignments: string[] = [];
      const values: (string | number)[] = [];

      if (fields.name !== undefined) {
        values.push(fields.name);
        assignments.push(`name = $${values.length}`);
      }

      if (fields.monthlyLimit !== undefined) {
        values.push(fields.monthlyLimit);
        assignments.push(`monthly_limit = $${values.length}`);
      }

      if (fields.maxUnitsPerRequest !== undefined) {
        values.push(fields.maxUnitsPerRequest);
        assignments.push(`max_units_per_request = $${values.length}`);
      }

      values.push(params.data.planId, accountId);

      const result = await client.query(
        `UPDATE plans
         SET ${assignments.join(", ")}, updated_at = NOW()
         WHERE id = $${values.length - 1}
           AND owner_account_id = $${values.length}
         RETURNING id, scope, name, monthly_limit, max_units_per_request,
                   is_builtin, created_at, updated_at`,
        values,
      );

      await client.query("COMMIT");
      inTransaction = false;

      return { plan: result.rows[0] };
    } catch (error) {
      if (inTransaction && await rollbackTransaction(client, app)) {
        inTransaction = false;
      }
      app.log.error(error);
      return reply.code(500).send({
        error: "INTERNAL_SERVER_ERROR",
        message: "Could not update the plan.",
      });
    } finally {
      client.release(inTransaction);
    }
  });

  // Assign an account-scope plan to the authenticated account.
  app.put("/plans/assign/account", async (request, reply) => {
    const accountId = await authenticate(request.headers["x-api-key"]);

    if (!accountId) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing or invalid API key.",
      });
    }

    const parsed = assignAccountSchema.safeParse(request.body);

    if (!parsed.success) {
      return validationError(reply, parsed.error.issues);
    }

    const client = await pool.connect();
    let inTransaction = false;

    try {
      await client.query("BEGIN");
      inTransaction = true;
      await lockAccount(client, accountId);

      const plan = await client.query(
        `SELECT id, name, monthly_limit, max_units_per_request
         FROM plans
         WHERE id = $1
           AND scope = 'account'
           AND (is_builtin = TRUE OR owner_account_id = $2)`,
        [parsed.data.planId, accountId],
      );

      if (plan.rowCount !== 1) {
        await client.query("ROLLBACK");
        inTransaction = false;
        return reply.code(404).send({
          error: "PLAN_NOT_FOUND",
          message: "An accessible account plan was not found.",
        });
      }

      await client.query(
        "UPDATE accounts SET account_plan_id = $1 WHERE id = $2",
        [parsed.data.planId, accountId],
      );

      await client.query("COMMIT");
      inTransaction = false;

      return { message: "Account plan updated.", plan: plan.rows[0] };
    } catch (error) {
      if (inTransaction && await rollbackTransaction(client, app)) {
        inTransaction = false;
      }
      app.log.error(error);
      return reply.code(500).send({
        error: "INTERNAL_SERVER_ERROR",
        message: "Could not assign the account plan.",
      });
    } finally {
      client.release(inTransaction);
    }
  });

  // Assign a user-scope plan to a user belonging to this account.
  app.put("/plans/assign/user", async (request, reply) => {
    const accountId = await authenticate(request.headers["x-api-key"]);

    if (!accountId) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing or invalid API key.",
      });
    }

    const parsed = assignUserSchema.safeParse(request.body);

    if (!parsed.success) {
      return validationError(reply, parsed.error.issues);
    }

    const client = await pool.connect();
    let inTransaction = false;

    try {
      await client.query("BEGIN");
      inTransaction = true;
      await lockAccount(client, accountId);

      const plan = await client.query(
        `SELECT id, name, monthly_limit, max_units_per_request
         FROM plans
         WHERE id = $1
           AND scope = 'user'
           AND (is_builtin = TRUE OR owner_account_id = $2)`,
        [parsed.data.planId, accountId],
      );

      if (plan.rowCount !== 1) {
        await client.query("ROLLBACK");
        inTransaction = false;
        return reply.code(404).send({
          error: "PLAN_NOT_FOUND",
          message: "An accessible user plan was not found.",
        });
      }

      const user = await client.query(
        `UPDATE users
         SET plan_id = $1
         WHERE id = $2 AND account_id = $3
         RETURNING id, name`,
        [parsed.data.planId, parsed.data.userId, accountId],
      );

      if (user.rowCount !== 1) {
        await client.query("ROLLBACK");
        inTransaction = false;
        return reply.code(404).send({
          error: "USER_NOT_FOUND",
          message: "User not found in this account.",
        });
      }

      await client.query("COMMIT");
      inTransaction = false;

      return {
        message: "User plan updated.",
        user: user.rows[0],
        plan: plan.rows[0],
      };
    } catch (error) {
      if (inTransaction && await rollbackTransaction(client, app)) {
        inTransaction = false;
      }
      app.log.error(error);
      return reply.code(500).send({
        error: "INTERNAL_SERVER_ERROR",
        message: "Could not assign the user plan.",
      });
    } finally {
      client.release(inTransaction);
    }
  });
}
