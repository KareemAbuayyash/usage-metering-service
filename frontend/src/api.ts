import { z } from "zod";

const numericValue = z.union([z.string(), z.number()]);

const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  plan: z.string(),
  apiKey: z.string(),
  warning: z.string(),
});

const userSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  plan: z.string(),
  createdAt: z.string(),
  usage: z.object({
    monthStart: z.string(),
    consumed: numericValue,
    limit: numericValue,
    remaining: numericValue,
  }),
});

const planSchema = z.object({
  id: z.string(),
  scope: z.enum(["account", "user"]),
  name: z.string(),
  monthly_limit: numericValue,
  max_units_per_request: numericValue,
  is_builtin: z.boolean(),
});

const currentUsageSchema = z.object({
  account: z.object({
    plan: z.string(),
    monthStart: z.string(),
    consumed: numericValue,
    limit: numericValue,
    remaining: numericValue,
    maxUnitsPerRequest: numericValue,
  }),
  user: z
    .object({
      id: z.string(),
      name: z.string(),
      plan: z.string(),
      monthStart: z.string(),
      consumed: numericValue,
      limit: numericValue,
      remaining: numericValue,
      maxUnitsPerRequest: numericValue,
    })
    .optional(),
});

const historySchema = z.object({
  data: z.array(
    z.object({
      request_id: z.string(),
      user_id: z.string(),
      user_name: z.string(),
      units: numericValue,
      status: z.enum(["accepted", "rejected"]),
      rejection_scope: z.string().nullable(),
      rejection_reason: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
  }),
});

const monthlyUsageSchema = z.object({
  monthStart: z.string(),
  account: z.object({
    consumed: numericValue,
    acceptedRequests: z.number(),
    rejectedRequests: z.number(),
  }),
  user: z.object({
    id: z.string(),
    name: z.string(),
    consumed: numericValue,
    acceptedRequests: z.number(),
    rejectedRequests: z.number(),
  }).optional(),
});

const consumeResultSchema = z.object({
  allowed: z.boolean(),
  requestId: z.string(),
  units: z.number(),
  scope: z.string().optional(),
  reason: z.string().optional(),
  replayed: z.boolean().optional(),
  accountUsage: z
    .object({ consumed: numericValue, limit: numericValue })
    .optional(),
  userUsage: z
    .object({ consumed: numericValue, limit: numericValue })
    .optional(),
});

export type Account = z.infer<typeof accountSchema>;
export type User = z.infer<typeof userSchema>;
export type Plan = z.infer<typeof planSchema>;
export type CurrentUsage = z.infer<typeof currentUsageSchema>;
export type History = z.infer<typeof historySchema>;
export type MonthlyUsage = z.infer<typeof monthlyUsageSchema>;
export type ConsumeResult = z.infer<typeof consumeResultSchema>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function responseMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload.message === "string") {
    return payload.message;
  }

  if (isRecord(payload) && typeof payload.error === "string") {
    return payload.error.replaceAll("_", " ").toLowerCase();
  }

  return fallback;
}

export class ApiClient {
  private readonly baseUrl =
    (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "");

  constructor(
    private readonly apiKey: string,
    private readonly onUnauthorized: () => void,
  ) {}

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: {
      method?: string;
      body?: unknown;
      authenticate?: boolean;
    } = {},
  ): Promise<T> {
    const headers = new Headers({ accept: "application/json" });
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (options.authenticate !== false && this.apiKey) {
      headers.set("x-api-key", this.apiKey);
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body:
          options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
      });
    } catch {
      throw new Error(
        "Could not reach the API. Check that the backend is running and try again.",
      );
    }

    let payload: unknown;
    try {
      const text = await response.text();
      payload = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      if (response.status === 401 && options.authenticate !== false) {
        this.onUnauthorized();
      }
      throw new ApiError(
        "The API returned an invalid response. Please try again.",
        response.status,
        null,
      );
    }

    if (!response.ok) {
      if (response.status === 401 && options.authenticate !== false) {
        this.onUnauthorized();
      }
      throw new ApiError(
        responseMessage(payload, `Request failed (${response.status}).`),
        response.status,
        payload,
      );
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        "The API response did not match the expected format. Refresh and try again.",
      );
    }

    return parsed.data;
  }

  createAccount(name: string, plan: string) {
    return this.request(
      "/accounts",
      accountSchema,
      { method: "POST", body: { name, plan }, authenticate: false },
    );
  }

  listUsers() {
    return this.request(
      "/users",
      z.object({ users: z.array(userSchema) }),
    );
  }

  createUser(name: string, plan: string) {
    return this.request(
      "/users",
      z.object({
        id: z.string(),
        accountId: z.string(),
        name: z.string(),
        plan: z.string(),
      }),
      { method: "POST", body: { name, plan } },
    );
  }

  listPlans() {
    return this.request(
      "/plans",
      z.object({ plans: z.array(planSchema) }),
    );
  }

  createPlan(input: {
    scope: "account" | "user";
    name: string;
    monthlyLimit: number;
    maxUnitsPerRequest: number;
  }) {
    return this.request(
      "/plans",
      z.object({ plan: planSchema }),
      { method: "POST", body: input },
    );
  }

  updatePlan(
    planId: string,
    input: {
      name: string;
      monthlyLimit: number;
      maxUnitsPerRequest: number;
    },
  ) {
    return this.request(
      `/plans/${encodeURIComponent(planId)}`,
      z.object({ plan: planSchema }),
      { method: "PATCH", body: input },
    );
  }

  assignAccountPlan(planId: string) {
    return this.request(
      "/plans/assign/account",
      z.object({ plan: z.object({ name: z.string() }) }),
      { method: "PUT", body: { planId } },
    );
  }

  assignUserPlan(userId: string, planId: string) {
    return this.request(
      "/plans/assign/user",
      z.object({ user: z.object({ id: z.string() }) }),
      { method: "PUT", body: { userId, planId } },
    );
  }

  getCurrentUsage(userId?: string) {
    const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    return this.request(`/usage/current${query}`, currentUsageSchema);
  }

  getHistory(input: {
    page: number;
    limit: number;
    status?: "accepted" | "rejected";
    userId?: string;
    month?: string;
  }) {
    const query = new URLSearchParams({
      page: String(input.page),
      limit: String(input.limit),
    });
    if (input.status) query.set("status", input.status);
    if (input.userId) query.set("userId", input.userId);
    if (input.month) query.set("month", input.month);
    return this.request(`/usage/history?${query}`, historySchema);
  }

  getMonthlyUsage(month: string, userId?: string) {
    const query = new URLSearchParams({ month });
    if (userId) query.set("userId", userId);
    return this.request(`/usage/monthly?${query}`, monthlyUsageSchema);
  }

  consume(userId: string, requestId: string, units: number) {
    return this.request(
      "/usage/consume",
      consumeResultSchema,
      {
        method: "POST",
        body: { userId, requestId, units },
      },
    );
  }
}

export function isUsageRejection(
  payload: unknown,
): payload is {
  allowed: false;
  requestId: string;
  units: number;
  scope: string;
  reason: string;
} {
  return (
    isRecord(payload) &&
    payload.allowed === false &&
    typeof payload.requestId === "string" &&
    typeof payload.units === "number" &&
    typeof payload.scope === "string" &&
    typeof payload.reason === "string"
  );
}
