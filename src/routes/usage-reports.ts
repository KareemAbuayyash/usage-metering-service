import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

const currentQuerySchema = z.object({
  userId: z.string().uuid().optional(),
});

const monthSchema = z.string().regex(
  /^\d{4}-(0[1-9]|1[0-2])$/,
  "Month must use YYYY-MM format.",
);

const monthlyQuerySchema = z.object({
  month: monthSchema,
  userId: z.string().uuid().optional(),
});

const historyQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  month: monthSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["accepted", "rejected"]).optional(),
});

function utcMonthStart(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}-01`;
}

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

function validationError(issues: z.ZodError["issues"]) {
  return {
    error: "VALIDATION_ERROR",
    details: issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export async function usageReportRoutes(app: FastifyInstance) {
  // Current monthly usage and remaining quota.
  app.get("/usage/current", async (request, reply) => {
    const accountId = await authenticate(request.headers["x-api-key"]);

    if (!accountId) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing or invalid API key.",
      });
    }

    const parsed = currentQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues));
    }

    const { userId } = parsed.data;
    const monthStart = utcMonthStart();

    const accountResult = await pool.query(
      `SELECT a.account_plan_id, p.name AS plan_name,
              p.monthly_limit, p.max_units_per_request
       FROM accounts a
       JOIN plans p ON p.id = a.account_plan_id
       WHERE a.id = $1
         AND p.scope = 'account'
         AND (p.is_builtin = TRUE OR p.owner_account_id = a.id)`,
      [accountId],
    );

    if (accountResult.rowCount !== 1) {
      return reply.code(500).send({
        error: "PLAN_CONFIGURATION_ERROR",
        message: "The account plan is unavailable.",
      });
    }

    const accountPlan = accountResult.rows[0];

    const accountUsageResult = await pool.query(
      `SELECT consumed_units
       FROM usage_periods
       WHERE account_id = $1
         AND user_id IS NULL
         AND month_start = $2`,
      [accountId, monthStart],
    );

    const accountConsumed = BigInt(
      accountUsageResult.rows[0]?.consumed_units ?? 0,
    );
    const accountLimit = BigInt(accountPlan.monthly_limit);

    const accountUsage = {
      plan: accountPlan.plan_name,
      monthStart,
      consumed: accountConsumed.toString(),
      limit: accountLimit.toString(),
      remaining: (accountLimit > accountConsumed
        ? accountLimit - accountConsumed
        : 0n
      ).toString(),
      maxUnitsPerRequest: String(accountPlan.max_units_per_request),
    };

    if (!userId) {
      return { account: accountUsage };
    }

    const userResult = await pool.query(
      `SELECT u.id, u.name, p.name AS plan_name,
              p.monthly_limit, p.max_units_per_request
       FROM users u
       JOIN plans p ON p.id = u.plan_id
       WHERE u.id = $1
         AND u.account_id = $2
         AND p.scope = 'user'
         AND (p.is_builtin = TRUE OR p.owner_account_id = u.account_id)`,
      [userId, accountId],
    );

    if (userResult.rowCount !== 1) {
      return reply.code(404).send({
        error: "USER_NOT_FOUND",
        message: "User not found in this account.",
      });
    }

    const user = userResult.rows[0];

    const userUsageResult = await pool.query(
      `SELECT consumed_units
       FROM usage_periods
       WHERE account_id = $1
         AND user_id = $2
         AND month_start = $3`,
      [accountId, userId, monthStart],
    );

    const userConsumed = BigInt(
      userUsageResult.rows[0]?.consumed_units ?? 0,
    );
    const userLimit = BigInt(user.monthly_limit);

    return {
      account: accountUsage,
      user: {
        id: user.id,
        name: user.name,
        plan: user.plan_name,
        monthStart,
        consumed: userConsumed.toString(),
        limit: userLimit.toString(),
        remaining: (userLimit > userConsumed
          ? userLimit - userConsumed
          : 0n
        ).toString(),
        maxUnitsPerRequest: String(user.max_units_per_request),
      },
    };
  });

  // Historical usage totals and request outcomes for a UTC calendar month.
  app.get("/usage/monthly", async (request, reply) => {
    const accountId = await authenticate(request.headers["x-api-key"]);

    if (!accountId) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing or invalid API key.",
      });
    }

    const parsed = monthlyQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues));
    }

    const { month, userId } = parsed.data;
    const monthStart = `${month}-01`;

    const accountResult = await pool.query(
      `SELECT
         COALESCE((
           SELECT consumed_units
           FROM usage_periods
           WHERE account_id = $1 AND user_id IS NULL AND month_start = $2
         ), 0)::text AS consumed,
         COUNT(*) FILTER (WHERE status = 'accepted')::text AS accepted_requests,
         COUNT(*) FILTER (WHERE status = 'rejected')::text AS rejected_requests
       FROM usage_requests
       WHERE account_id = $1
         AND created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
         AND created_at < (($2::date + INTERVAL '1 month')::timestamp AT TIME ZONE 'UTC')`,
      [accountId, monthStart],
    );

    const account = accountResult.rows[0];
    const report = {
      monthStart,
      account: {
        consumed: account.consumed,
        acceptedRequests: Number(account.accepted_requests),
        rejectedRequests: Number(account.rejected_requests),
      },
    };

    if (!userId) {
      return report;
    }

    const userResult = await pool.query(
      `SELECT u.id, u.name,
         COALESCE((
           SELECT consumed_units
           FROM usage_periods
           WHERE account_id = $2 AND user_id = u.id AND month_start = $3
         ), 0)::text AS consumed,
         COUNT(r.id) FILTER (WHERE r.status = 'accepted')::text AS accepted_requests,
         COUNT(r.id) FILTER (WHERE r.status = 'rejected')::text AS rejected_requests
       FROM users u
       LEFT JOIN usage_requests r
         ON r.account_id = u.account_id
        AND r.user_id = u.id
         AND r.created_at >= ($3::date::timestamp AT TIME ZONE 'UTC')
         AND r.created_at < (($3::date + INTERVAL '1 month')::timestamp AT TIME ZONE 'UTC')
       WHERE u.id = $1 AND u.account_id = $2
       GROUP BY u.id, u.name`,
      [userId, accountId, monthStart],
    );

    if (userResult.rowCount !== 1) {
      return reply.code(404).send({
        error: "USER_NOT_FOUND",
        message: "User not found in this account.",
      });
    }

    const user = userResult.rows[0];

    return {
      ...report,
      user: {
        id: user.id,
        name: user.name,
        consumed: user.consumed,
        acceptedRequests: Number(user.accepted_requests),
        rejectedRequests: Number(user.rejected_requests),
      },
    };
  });

  // Paginated request history, scoped to the authenticated account.
  app.get("/usage/history", async (request, reply) => {
    const accountId = await authenticate(request.headers["x-api-key"]);

    if (!accountId) {
      return reply.code(401).send({
        error: "UNAUTHORIZED",
        message: "Missing or invalid API key.",
      });
    }

    const parsed = historyQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send(validationError(parsed.error.issues));
    }

    const { userId, month, page, limit, status } = parsed.data;
    const offset = (page - 1) * limit;

    const conditions = ["r.account_id = $1"];
    const values: (string | number)[] = [accountId];

    if (userId) {
      values.push(userId);
      conditions.push(`r.user_id = $${values.length}`);
    }

    if (status) {
      values.push(status);
      conditions.push(`r.status = $${values.length}`);
    }

    if (month) {
      values.push(`${month}-01`);
      conditions.push(
        `r.created_at >= ($${values.length}::date::timestamp AT TIME ZONE 'UTC') AND r.created_at < (($${values.length}::date + INTERVAL '1 month')::timestamp AT TIME ZONE 'UTC')`,
      );
    }

    const whereClause = conditions.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(*)::text AS total
       FROM usage_requests r
       WHERE ${whereClause}`,
      values,
    );

    values.push(limit);
    const limitPosition = values.length;
    values.push(offset);
    const offsetPosition = values.length;

    const historyResult = await pool.query(
      `SELECT r.request_id, r.user_id, u.name AS user_name,
              r.units::text AS units, r.status,
              r.rejection_scope, r.rejection_reason, r.created_at
       FROM usage_requests r
       JOIN users u ON u.id = r.user_id AND u.account_id = r.account_id
       WHERE ${whereClause}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
      values,
    );

    const total = Number(countResult.rows[0].total);

    return {
      data: historyResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: offset + historyResult.rows.length < total,
        hasPreviousPage: page > 1,
      },
    };
  });
}
