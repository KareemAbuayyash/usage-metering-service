
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/index.js";
import { pool } from "../src/db.js";

const createdAccountIds: string[] = [];
const createdUserIds: string[] = [];

describe("API endpoints", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();

    try {
      if (createdAccountIds.length > 0) {
        await pool.query(
          "DELETE FROM usage_requests WHERE account_id = ANY($1::uuid[])",
          [createdAccountIds],
        );

        await pool.query(
          "DELETE FROM usage_periods WHERE account_id = ANY($1::uuid[])",
          [createdAccountIds],
        );
      }

      if (createdUserIds.length > 0) {
        await pool.query(
          "DELETE FROM users WHERE id = ANY($1::uuid[])",
          [createdUserIds],
        );
      }

      if (createdAccountIds.length > 0) {
        await pool.query(
          "DELETE FROM accounts WHERE id = ANY($1::uuid[])",
          [createdAccountIds],
        );
      }
    } finally {
      await pool.end();
    }
  });

  it("GET /health returns service status", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      service: "usage-metering-service",
    });
  });

  it("POST /accounts rejects an invalid account name", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: "A",
        plan: "Starter",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("VALIDATION_ERROR");
  });

  it("POST /accounts creates a new account", async () => {
    const accountName = `Vitest Test Account ${Date.now()}`;

    const response = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: accountName,
        plan: "Starter",
      },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();

    expect(body.id).toBeDefined();
    expect(body.name).toBe(accountName);
    expect(body.plan).toBe("Starter");
    expect(body.apiKey).toMatch(/^ums_/);

    createdAccountIds.push(body.id);
  });

  it("GET /plans rejects a missing API key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/plans",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("UNAUTHORIZED");
  });

  it("GET /plans rejects an invalid API key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/plans",
      headers: {
        "x-api-key": "invalid_test_key",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("UNAUTHORIZED");
  });

  
  it("GET /health/db confirms database connectivity", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health/db",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("ok");
    expect(response.json().database).toBe("connected");
  });

  it("POST /users creates a user under the authenticated account", async () => {
    const accountName = `Vitest User Test ${Date.now()}`;

    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: accountName,
        plan: "Starter",
      },
    });

    expect(accountResponse.statusCode).toBe(201);

    const account = accountResponse.json();

    createdAccountIds.push(account.id);

    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        name: "Vitest Test User",
        plan: "Basic",
      },
    });

    expect(userResponse.statusCode).toBe(201);

    const user = userResponse.json();

    expect(user.id).toBeDefined();
    expect(user.accountId).toBe(account.id);
    expect(user.name).toBe("Vitest Test User");
    expect(user.plan).toBe("Basic");

    createdUserIds.push(user.id);
  });

  it("GET /users rejects missing and invalid API keys", async () => {
    const missingKeyResponse = await app.inject({
      method: "GET",
      url: "/users",
    });

    expect(missingKeyResponse.statusCode).toBe(401);
    expect(missingKeyResponse.json().error).toBe("UNAUTHORIZED");

    const invalidKeyResponse = await app.inject({
      method: "GET",
      url: "/users",
      headers: {
        "x-api-key": "invalid_test_key",
      },
    });

    expect(invalidKeyResponse.statusCode).toBe(401);
    expect(invalidKeyResponse.json().error).toBe("UNAUTHORIZED");
  });

  it("GET /users lists only users belonging to the authenticated account", async () => {
    const accountAResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Users A ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountAResponse.statusCode).toBe(201);
    const accountA = accountAResponse.json();
    createdAccountIds.push(accountA.id);

    const userAResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: { "x-api-key": accountA.apiKey },
      payload: { name: "Account A User", plan: "Basic" },
    });

    expect(userAResponse.statusCode).toBe(201);
    const userA = userAResponse.json();
    createdUserIds.push(userA.id);

    const accountBResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Users B ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountBResponse.statusCode).toBe(201);
    const accountB = accountBResponse.json();
    createdAccountIds.push(accountB.id);

    const userBResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: { "x-api-key": accountB.apiKey },
      payload: { name: "Account B User", plan: "Premium" },
    });

    expect(userBResponse.statusCode).toBe(201);
    const userB = userBResponse.json();
    createdUserIds.push(userB.id);

    const usageResponse = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: { "x-api-key": accountA.apiKey },
      payload: {
        userId: userA.id,
        requestId: `vitest-users-list-${Date.now()}`,
        units: 3,
      },
    });

    expect(usageResponse.statusCode).toBe(200);

    const listAResponse = await app.inject({
      method: "GET",
      url: "/users",
      headers: { "x-api-key": accountA.apiKey },
    });

    expect(listAResponse.statusCode).toBe(200);
    expect(listAResponse.json().users).toEqual([
      expect.objectContaining({
        id: userA.id,
        accountId: accountA.id,
        name: "Account A User",
        plan: "Basic",
        usage: {
          monthStart: expect.any(String),
          consumed: "3",
          limit: "1000",
          remaining: "997",
        },
      }),
    ]);
    expect(listAResponse.json().users).not.toContainEqual(
      expect.objectContaining({ id: userB.id }),
    );

    const listBResponse = await app.inject({
      method: "GET",
      url: "/users",
      headers: { "x-api-key": accountB.apiKey },
    });

    expect(listBResponse.statusCode).toBe(200);
    expect(listBResponse.json().users.map((user: { id: string }) => user.id))
      .toEqual([userB.id]);
  });

  it("POST /usage/consume rejects a missing API key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/usage/consume",
      payload: {
        userId: "00000000-0000-4000-8000-000000000001",
        requestId: "test-missing-api-key",
        units: 1,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("UNAUTHORIZED");
  });

  it("POST /usage/consume accepts a valid usage request", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Usage Test ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountResponse.statusCode).toBe(201);

    const account = accountResponse.json();
    createdAccountIds.push(account.id);

    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        name: "Usage Test User",
        plan: "Basic",
      },
    });

    expect(userResponse.statusCode).toBe(201);

    const user = userResponse.json();
    createdUserIds.push(user.id);

    const requestId = `vitest-usage-${Date.now()}`;

    const usageResponse = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        userId: user.id,
        requestId,
        units: 1,
      },
    });

    expect(usageResponse.statusCode).toBe(200);

    const usage = usageResponse.json();

    expect(usage.allowed).toBe(true);
    expect(usage.requestId).toBe(requestId);
    expect(usage.units).toBe(1);
    expect(usage.accountUsage.consumed).toBe(1);
    expect(usage.userUsage.consumed).toBe(1);
  });

  it("POST /usage/consume does not charge the same request twice", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Idempotency ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountResponse.statusCode).toBe(201);

    const account = accountResponse.json();
    createdAccountIds.push(account.id);

    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        name: "Idempotency Test User",
        plan: "Basic",
      },
    });

    expect(userResponse.statusCode).toBe(201);

    const user = userResponse.json();
    createdUserIds.push(user.id);

    const payload = {
      userId: user.id,
      requestId: `vitest-idempotency-${Date.now()}`,
      units: 1,
    };

    const firstResponse = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload,
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json().allowed).toBe(true);

    const secondResponse = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload,
    });

    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.json().allowed).toBe(true);
    expect(secondResponse.json().replayed).toBe(true);
    expect(secondResponse.json().units).toBe(1);

    const currentResponse = await app.inject({
      method: "GET",
      url: `/usage/current?userId=${user.id}`,
      headers: {
        "x-api-key": account.apiKey,
      },
    });

    expect(currentResponse.statusCode).toBe(200);
    expect(currentResponse.json().account.consumed).toBe("1");
    expect(currentResponse.json().user.consumed).toBe("1");
  });

  it("POST /usage/consume rejects reusing a request ID with different data", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Conflict ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountResponse.statusCode).toBe(201);

    const account = accountResponse.json();
    createdAccountIds.push(account.id);

    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        name: "Conflict Test User",
        plan: "Basic",
      },
    });

    expect(userResponse.statusCode).toBe(201);

    const user = userResponse.json();
    createdUserIds.push(user.id);

    const requestId = `vitest-conflict-${Date.now()}`;

    const firstResponse = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        userId: user.id,
        requestId,
        units: 1,
      },
    });

    expect(firstResponse.statusCode).toBe(200);

    const secondResponse = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        userId: user.id,
        requestId,
        units: 2,
      },
    });

    expect(secondResponse.statusCode).toBe(409);
    expect(secondResponse.json().error).toBe("IDEMPOTENCY_CONFLICT");

    const currentResponse = await app.inject({
      method: "GET",
      url: `/usage/current?userId=${user.id}`,
      headers: {
        "x-api-key": account.apiKey,
      },
    });

    expect(currentResponse.statusCode).toBe(200);
    expect(currentResponse.json().account.consumed).toBe("1");
    expect(currentResponse.json().user.consumed).toBe("1");
  });

  it("POST /usage/consume rejects requests above the user's limit", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Limit ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountResponse.statusCode).toBe(201);

    const account = accountResponse.json();
    createdAccountIds.push(account.id);

    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        name: "Limit Test User",
        plan: "Basic",
      },
    });

    expect(userResponse.statusCode).toBe(201);

    const user = userResponse.json();
    createdUserIds.push(user.id);

    const response = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        userId: user.id,
        requestId: `vitest-limit-${Date.now()}`,
        units: 21,
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().allowed).toBe(false);
    expect(response.json().reason).toBe("MAX_UNITS_PER_REQUEST");
    expect(response.json().scope).toBe("user");

    const currentResponse = await app.inject({
      method: "GET",
      url: `/usage/current?userId=${user.id}`,
      headers: {
        "x-api-key": account.apiKey,
      },
    });

    expect(currentResponse.statusCode).toBe(200);
    expect(currentResponse.json().account.consumed).toBe("0");
    expect(currentResponse.json().user.consumed).toBe("0");
  });

  it("POST /usage/consume enforces the account's monthly limit", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Monthly Limit ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountResponse.statusCode).toBe(201);

    const account = accountResponse.json();
    createdAccountIds.push(account.id);

    const planResponse = await app.inject({
      method: "POST",
      url: "/plans",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        scope: "account",
        name: `Test Monthly ${Date.now()}`,
        monthlyLimit: 5,
        maxUnitsPerRequest: 5,
      },
    });

    expect(planResponse.statusCode).toBe(201);

    const plan = planResponse.json().plan;

    const assignResponse = await app.inject({
      method: "PUT",
      url: "/plans/assign/account",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        planId: plan.id,
      },
    });

    expect(assignResponse.statusCode).toBe(200);

    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        name: "Monthly Limit User",
        plan: "Basic",
      },
    });

    expect(userResponse.statusCode).toBe(201);

    const user = userResponse.json();
    createdUserIds.push(user.id);

    const firstResponse = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        userId: user.id,
        requestId: `vitest-monthly-first-${Date.now()}`,
        units: 5,
      },
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json().allowed).toBe(true);
    expect(firstResponse.json().accountUsage.consumed).toBe(5);
    expect(firstResponse.json().userUsage.consumed).toBe(5);
    expect(firstResponse.json().userUsage.limit).toBe(1000);

    const secondResponse = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        userId: user.id,
        requestId: `vitest-monthly-second-${Date.now()}`,
        units: 1,
      },
    });

    expect(secondResponse.statusCode).toBe(429);
    expect(secondResponse.json().allowed).toBe(false);
    expect(secondResponse.json().reason).toBe("MONTHLY_LIMIT_EXCEEDED");
    expect(secondResponse.json().scope).toBe("account");

    const currentResponse = await app.inject({
      method: "GET",
      url: `/usage/current?userId=${user.id}`,
      headers: {
        "x-api-key": account.apiKey,
      },
    });

    expect(currentResponse.statusCode).toBe(200);
    expect(currentResponse.json().account.consumed).toBe("5");
    expect(currentResponse.json().account.remaining).toBe("0");
    expect(currentResponse.json().user.consumed).toBe("5");
    expect(currentResponse.json().user.remaining).toBe("995");
  });

  it("GET /usage/current prevents cross-account user access", async () => {
    const accountAResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Isolation A ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountAResponse.statusCode).toBe(201);

    const accountA = accountAResponse.json();
    createdAccountIds.push(accountA.id);

    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: {
        "x-api-key": accountA.apiKey,
      },
      payload: {
        name: "Private User A",
        plan: "Basic",
      },
    });

    expect(userResponse.statusCode).toBe(201);

    const userA = userResponse.json();
    createdUserIds.push(userA.id);

    const accountBResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Isolation B ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountBResponse.statusCode).toBe(201);

    const accountB = accountBResponse.json();
    createdAccountIds.push(accountB.id);

    const response = await app.inject({
      method: "GET",
      url: `/usage/current?userId=${userA.id}`,
      headers: {
        "x-api-key": accountB.apiKey,
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it("GET /usage/history prevents cross-account access", async () => {
    const accountAResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest History A ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountAResponse.statusCode).toBe(201);

    const accountA = accountAResponse.json();
    createdAccountIds.push(accountA.id);

    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: {
        "x-api-key": accountA.apiKey,
      },
      payload: {
        name: "History Private User",
        plan: "Basic",
      },
    });

    expect(userResponse.statusCode).toBe(201);

    const userA = userResponse.json();
    createdUserIds.push(userA.id);

    const usageResponse = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: {
        "x-api-key": accountA.apiKey,
      },
      payload: {
        userId: userA.id,
        requestId: `vitest-history-${Date.now()}`,
        units: 1,
      },
    });

    expect(usageResponse.statusCode).toBe(200);
    expect(usageResponse.json().allowed).toBe(true);

    const accountBResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest History B ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountBResponse.statusCode).toBe(201);

    const accountB = accountBResponse.json();
    createdAccountIds.push(accountB.id);

    const historyResponse = await app.inject({
      method: "GET",
      url: "/usage/history",
      headers: {
        "x-api-key": accountB.apiKey,
      },
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json().data).toEqual([]);
  });

  it("POST /usage/consume enforces the account quota under concurrent requests", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Concurrency ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountResponse.statusCode).toBe(201);

    const account = accountResponse.json();
    createdAccountIds.push(account.id);

    const planResponse = await app.inject({
      method: "POST",
      url: "/plans",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        scope: "account",
        name: `Concurrency Limit ${Date.now()}`,
        monthlyLimit: 10,
        maxUnitsPerRequest: 10,
      },
    });

    expect(planResponse.statusCode).toBe(201);

    const plan = planResponse.json().plan;

    const assignResponse = await app.inject({
      method: "PUT",
      url: "/plans/assign/account",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        planId: plan.id,
      },
    });

    expect(assignResponse.statusCode).toBe(200);

    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        name: "Concurrency Test User",
        plan: "Basic",
      },
    });

    expect(userResponse.statusCode).toBe(201);

    const user = userResponse.json();
    createdUserIds.push(user.id);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        app.inject({
          method: "POST",
          url: "/usage/consume",
          headers: {
            "x-api-key": account.apiKey,
          },
          payload: {
            userId: user.id,
            requestId: `concurrency-${Date.now()}-${index}`,
            units: 2,
          },
        }),
      ),
    );

    const accepted = responses.filter(
      (response) => response.statusCode === 200,
    );

    const rejected = responses.filter(
      (response) => response.statusCode === 429,
    );

    expect(accepted).toHaveLength(5);
    expect(rejected).toHaveLength(5);

    for (const response of rejected) {
      expect(response.json().allowed).toBe(false);
      expect(response.json().reason).toBe("MONTHLY_LIMIT_EXCEEDED");
      expect(response.json().scope).toBe("account");
    }

    const usageResponse = await app.inject({
      method: "GET",
      url: `/usage/current?userId=${user.id}`,
      headers: {
        "x-api-key": account.apiKey,
      },
    });

    expect(usageResponse.statusCode).toBe(200);
    expect(usageResponse.json().account.consumed).toBe("10");
    expect(usageResponse.json().user.consumed).toBe("10");
  });

  it("POST /usage/consume enforces a user's monthly limit under concurrent requests", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest User Concurrency ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountResponse.statusCode).toBe(201);

    const account = accountResponse.json();
    createdAccountIds.push(account.id);

    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        name: "User Concurrency Test",
        plan: "Basic",
      },
    });

    expect(userResponse.statusCode).toBe(201);

    const user = userResponse.json();
    createdUserIds.push(user.id);

    const planResponse = await app.inject({
      method: "POST",
      url: "/plans",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        scope: "user",
        name: `Concurrent User Limit ${Date.now()}`,
        monthlyLimit: 10,
        maxUnitsPerRequest: 2,
      },
    });

    expect(planResponse.statusCode).toBe(201);

    const assignResponse = await app.inject({
      method: "PUT",
      url: "/plans/assign/user",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        userId: user.id,
        planId: planResponse.json().plan.id,
      },
    });

    expect(assignResponse.statusCode).toBe(200);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        app.inject({
          method: "POST",
          url: "/usage/consume",
          headers: {
            "x-api-key": account.apiKey,
          },
          payload: {
            userId: user.id,
            requestId: `user-concurrency-${Date.now()}-${index}`,
            units: 2,
          },
        }),
      ),
    );

    const accepted = responses.filter(
      (response) => response.statusCode === 200,
    );
    const rejected = responses.filter(
      (response) => response.statusCode === 429,
    );

    expect(accepted).toHaveLength(5);
    expect(rejected).toHaveLength(5);

    for (const response of rejected) {
      expect(response.json().allowed).toBe(false);
      expect(response.json().reason).toBe("MONTHLY_LIMIT_EXCEEDED");
      expect(response.json().scope).toBe("user");
    }

    const usageResponse = await app.inject({
      method: "GET",
      url: `/usage/current?userId=${user.id}`,
      headers: {
        "x-api-key": account.apiKey,
      },
    });

    expect(usageResponse.statusCode).toBe(200);
    expect(usageResponse.json().account.consumed).toBe("10");
    expect(usageResponse.json().user.consumed).toBe("10");
    expect(usageResponse.json().user.remaining).toBe("0");
  });

  it("POST /usage/consume applies updated account plan limits to future requests", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Plan Update ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountResponse.statusCode).toBe(201);

    const account = accountResponse.json();
    createdAccountIds.push(account.id);

    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        name: "Plan Update Test User",
        plan: "Basic",
      },
    });

    expect(userResponse.statusCode).toBe(201);

    const user = userResponse.json();
    createdUserIds.push(user.id);

    const firstUsage = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        userId: user.id,
        requestId: `plan-update-before-${Date.now()}`,
        units: 5,
      },
    });

    expect(firstUsage.statusCode).toBe(200);

    const planResponse = await app.inject({
      method: "POST",
      url: "/plans",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        scope: "account",
        name: `Updated Account Limit ${Date.now()}`,
        monthlyLimit: 3,
        maxUnitsPerRequest: 10,
      },
    });

    expect(planResponse.statusCode).toBe(201);

    const plan = planResponse.json().plan;

    const assignResponse = await app.inject({
      method: "PUT",
      url: "/plans/assign/account",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        planId: plan.id,
      },
    });

    expect(assignResponse.statusCode).toBe(200);

    const nextUsage = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: {
        "x-api-key": account.apiKey,
      },
      payload: {
        userId: user.id,
        requestId: `plan-update-after-${Date.now()}`,
        units: 1,
      },
    });

    expect(nextUsage.statusCode).toBe(429);
    expect(nextUsage.json().allowed).toBe(false);
    expect(nextUsage.json().reason).toBe("MONTHLY_LIMIT_EXCEEDED");
    expect(nextUsage.json().scope).toBe("account");

    const usageResponse = await app.inject({
      method: "GET",
      url: `/usage/current?userId=${user.id}`,
      headers: {
        "x-api-key": account.apiKey,
      },
    });

    expect(usageResponse.statusCode).toBe(200);
    expect(usageResponse.json().account.consumed).toBe("5");
    expect(usageResponse.json().user.consumed).toBe("5");
  });

  it("GET /usage/monthly reports historical usage and filters history by UTC month", async () => {
    const accountAResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Monthly Report A ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountAResponse.statusCode).toBe(201);
    const accountA = accountAResponse.json();
    createdAccountIds.push(accountA.id);

    const userAResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: { "x-api-key": accountA.apiKey },
      payload: { name: "Monthly Report User A", plan: "Basic" },
    });

    expect(userAResponse.statusCode).toBe(201);
    const userA = userAResponse.json();
    createdUserIds.push(userA.id);

    const accountBResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: `Vitest Monthly Report B ${Date.now()}`,
        plan: "Starter",
      },
    });

    expect(accountBResponse.statusCode).toBe(201);
    const accountB = accountBResponse.json();
    createdAccountIds.push(accountB.id);

    const userBResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: { "x-api-key": accountB.apiKey },
      payload: { name: "Monthly Report User B", plan: "Basic" },
    });

    expect(userBResponse.statusCode).toBe(201);
    const userB = userBResponse.json();
    createdUserIds.push(userB.id);

    const previousMonthDate = new Date();
    previousMonthDate.setUTCDate(1);
    previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth() - 1);
    const month = `${previousMonthDate.getUTCFullYear()}-${String(
      previousMonthDate.getUTCMonth() + 1,
    ).padStart(2, "0")}`;
    const monthStart = `${month}-01`;

    await pool.query(
      `INSERT INTO usage_periods (account_id, user_id, month_start, consumed_units)
       VALUES ($1, NULL, $3, 5), ($1, $2, $3, 5),
              ($4, NULL, $3, 9), ($4, $5, $3, 9)`,
      [accountA.id, userA.id, monthStart, accountB.id, userB.id],
    );

    await pool.query(
      `INSERT INTO usage_requests (
         account_id, user_id, request_id, request_hash, units, status,
         rejection_scope, rejection_reason, created_at
       )
       VALUES
         ($1, $2, $3, $4, 5, 'accepted', NULL, NULL, $6::date::timestamp AT TIME ZONE 'UTC' + INTERVAL '2 days'),
         ($1, $2, $5, $4, 1, 'rejected', 'account', 'MONTHLY_LIMIT_EXCEEDED', $6::date::timestamp AT TIME ZONE 'UTC' + INTERVAL '3 days'),
         ($7, $8, $9, $4, 9, 'accepted', NULL, NULL, $6::date::timestamp AT TIME ZONE 'UTC' + INTERVAL '2 days')`,
      [
        accountA.id,
        userA.id,
        `monthly-report-accepted-${Date.now()}`,
        "a".repeat(64),
        `monthly-report-rejected-${Date.now()}`,
        monthStart,
        accountB.id,
        userB.id,
        `monthly-report-other-account-${Date.now()}`,
      ],
    );

    const missingKeyResponse = await app.inject({
      method: "GET",
      url: `/usage/monthly?month=${month}`,
    });
    expect(missingKeyResponse.statusCode).toBe(401);

    const invalidMonthResponse = await app.inject({
      method: "GET",
      url: "/usage/monthly?month=2026-13",
      headers: { "x-api-key": accountA.apiKey },
    });
    expect(invalidMonthResponse.statusCode).toBe(400);

    const monthlyResponse = await app.inject({
      method: "GET",
      url: `/usage/monthly?month=${month}&userId=${userA.id}`,
      headers: { "x-api-key": accountA.apiKey },
    });

    expect(monthlyResponse.statusCode).toBe(200);
    expect(monthlyResponse.json()).toEqual({
      monthStart,
      account: {
        consumed: "5",
        acceptedRequests: 1,
        rejectedRequests: 1,
      },
      user: {
        id: userA.id,
        name: userA.name,
        consumed: "5",
        acceptedRequests: 1,
        rejectedRequests: 1,
      },
    });

    const historyResponse = await app.inject({
      method: "GET",
      url: `/usage/history?month=${month}&userId=${userA.id}`,
      headers: { "x-api-key": accountA.apiKey },
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json().pagination.total).toBe(2);
    expect(historyResponse.json().data).toHaveLength(2);

    const crossAccountUserResponse = await app.inject({
      method: "GET",
      url: `/usage/monthly?month=${month}&userId=${userB.id}`,
      headers: { "x-api-key": accountA.apiKey },
    });
    expect(crossAccountUserResponse.statusCode).toBe(404);
    expect(crossAccountUserResponse.json().error).toBe("USER_NOT_FOUND");
  });

});
