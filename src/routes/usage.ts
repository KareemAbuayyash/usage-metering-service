import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

const consumeSchema = z.object({
  userId: z.string().uuid(),
  requestId: z.string().trim().min(1).max(200),
  units: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

function hashRequest(userId: string, units: number): string {
  return createHash("sha256")
    .update(JSON.stringify({ userId, units }))
    .digest("hex");
}

function utcMonthStart(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");

  return `${now.getUTCFullYear()}-${month}-01`;
}

export async function usageRoutes(app: FastifyInstance) {
  app.post("/usage/consume", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];

    if (typeof apiKey !== "string" || apiKey.length === 0) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing API key.",
      });
    }

    const parsed = consumeSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { userId, requestId, units } = parsed.data;

    const apiKeyHash = createHash("sha256")
      .update(apiKey)
      .digest("hex");

    const requestHash = hashRequest(userId, units);
    const monthStart = utcMonthStart();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Lock the account so concurrent consumption requests
      // for this account are processed safely in sequence.
      const accountResult = await client.query(
        `SELECT id, account_plan_id
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

      const account = accountResult.rows[0];

      // Check idempotency before processing the request again.
      const previousResult = await client.query(
        `SELECT request_hash, units, status,
                rejection_scope, rejection_reason
         FROM usage_requests
         WHERE account_id = $1 AND request_id = $2`,
        [account.id, requestId],
      );

      if (previousResult.rowCount === 1) {
        const previous = previousResult.rows[0];

        if (previous.request_hash.trim() !== requestHash) {
          await client.query("ROLLBACK");

          return reply.code(409).send({
            error: "IDEMPOTENCY_CONFLICT",
            message: "This request ID was already used with different data.",
          });
        }

        await client.query("COMMIT");

        if (previous.status === "accepted") {
          return reply.send({
            allowed: true,
            requestId,
            units: Number(previous.units),
            replayed: true,
            message: "Already processed; usage was not charged again.",
          });
        }

        const statusCode =
          previous.rejection_reason === "MAX_UNITS_PER_REQUEST"
            ? 422
            : 429;

        return reply.code(statusCode).send({
          allowed: false,
          requestId,
          units: Number(previous.units),
          scope: previous.rejection_scope,
          reason: previous.rejection_reason,
          replayed: true,
        });
      }

      // Find the user only inside this authenticated account.
      const userResult = await client.query(
        `SELECT u.id, u.plan_id
         FROM users u
         WHERE u.id = $1 AND u.account_id = $2
         FOR UPDATE`,
        [userId, account.id],
      );

      if (userResult.rowCount !== 1) {
        await client.query("ROLLBACK");

        return reply.code(404).send({
          error: "USER_NOT_FOUND",
          message: "User was not found in this account.",
        });
      }

      const user = userResult.rows[0];

      const accountPlanResult = await client.query(
        `SELECT name, monthly_limit, max_units_per_request
         FROM plans
         WHERE id = $1
           AND scope = 'account'
           AND (is_builtin = TRUE OR owner_account_id = $2)`,
        [account.account_plan_id, account.id],
      );

      const userPlanResult = await client.query(
        `SELECT p.name, p.monthly_limit, p.max_units_per_request
         FROM plans p
         WHERE p.id = $1
           AND p.scope = 'user'
           AND (p.is_builtin = TRUE OR p.owner_account_id = $2)`,
        [user.plan_id, account.id],
      );

      if (
        accountPlanResult.rowCount !== 1 ||
        userPlanResult.rowCount !== 1
      ) {
        await client.query("ROLLBACK");

        return reply.code(500).send({
          error: "PLAN_CONFIGURATION_ERROR",
          message: "The account or user plan is unavailable.",
        });
      }

      const accountPlan = accountPlanResult.rows[0];
      const userPlan = userPlanResult.rows[0];

      const accountLimit = Number(accountPlan.monthly_limit);
      const accountMaxRequest = Number(
        accountPlan.max_units_per_request,
      );
      const userLimit = Number(userPlan.monthly_limit);
      const userMaxRequest = Number(
        userPlan.max_units_per_request,
      );

      let rejection:
        | { scope: "account" | "user"; reason: string }
        | undefined;

      if (units > accountMaxRequest) {
        rejection = {
          scope: "account",
          reason: "MAX_UNITS_PER_REQUEST",
        };
      } else if (units > userMaxRequest) {
        rejection = {
          scope: "user",
          reason: "MAX_UNITS_PER_REQUEST",
        };
      }

      // Read usage for the current UTC calendar month.
      const accountUsageResult = await client.query(
        `SELECT consumed_units
         FROM usage_periods
         WHERE account_id = $1
           AND user_id IS NULL
           AND month_start = $2`,
        [account.id, monthStart],
      );

      const userUsageResult = await client.query(
        `SELECT consumed_units
         FROM usage_periods
         WHERE account_id = $1
           AND user_id = $2
           AND month_start = $3`,
        [account.id, user.id, monthStart],
      );

      const accountConsumed = Number(
        accountUsageResult.rows[0]?.consumed_units ?? 0,
      );
      const userConsumed = Number(
        userUsageResult.rows[0]?.consumed_units ?? 0,
      );

      if (!rejection && accountConsumed + units > accountLimit) {
        rejection = {
          scope: "account",
          reason: "MONTHLY_LIMIT_EXCEEDED",
        };
      } else if (!rejection && userConsumed + units > userLimit) {
        rejection = {
          scope: "user",
          reason: "MONTHLY_LIMIT_EXCEEDED",
        };
      }

      if (rejection) {
        await client.query(
          `INSERT INTO usage_requests (
             account_id, user_id, request_id, request_hash,
             units, status, rejection_scope, rejection_reason
           )
           VALUES ($1, $2, $3, $4, $5, 'rejected', $6, $7)`,
          [
            account.id,
            user.id,
            requestId,
            requestHash,
            units,
            rejection.scope,
            rejection.reason,
          ],
        );

        await client.query("COMMIT");

        return reply
          .code(
            rejection.reason === "MAX_UNITS_PER_REQUEST" ? 422 : 429,
          )
          .send({
            allowed: false,
            requestId,
            units,
            scope: rejection.scope,
            reason: rejection.reason,
          });
      }

      // Both counters and the request history are committed together.
      await client.query(
        `INSERT INTO usage_periods (
           account_id, user_id, month_start, consumed_units
         )
         VALUES ($1, NULL, $2, $3)
         ON CONFLICT (account_id, month_start)
           WHERE user_id IS NULL
         DO UPDATE SET
           consumed_units =
             usage_periods.consumed_units + EXCLUDED.consumed_units,
           updated_at = NOW()`,
        [account.id, monthStart, units],
      );

      await client.query(
        `INSERT INTO usage_periods (
           account_id, user_id, month_start, consumed_units
         )
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_id, user_id, month_start)
           WHERE user_id IS NOT NULL
         DO UPDATE SET
           consumed_units =
             usage_periods.consumed_units + EXCLUDED.consumed_units,
           updated_at = NOW()`,
        [account.id, user.id, monthStart, units],
      );

      await client.query(
        `INSERT INTO usage_requests (
           account_id, user_id, request_id, request_hash,
           units, status
         )
         VALUES ($1, $2, $3, $4, $5, 'accepted')`,
        [account.id, user.id, requestId, requestHash, units],
      );

      await client.query("COMMIT");

      return reply.code(200).send({
        allowed: true,
        requestId,
        units,
        accountUsage: {
          consumed: accountConsumed + units,
          limit: accountLimit,
        },
        userUsage: {
          consumed: userConsumed + units,
          limit: userLimit,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      app.log.error(error);

      return reply.code(500).send({
        error: "INTERNAL_SERVER_ERROR",
        message: "Could not process usage.",
      });
    } finally {
      client.release();
    }
  });
}
