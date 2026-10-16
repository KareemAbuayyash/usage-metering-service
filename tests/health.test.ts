
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

    const currentResponse = await app.inject({
      method: "GET",
      url: `/usage/current?userId=${user.id}`,
      headers: {
        "x-api-key": account.apiKey,
      },
    });

    expect(currentResponse.statusCode).toBe(200);
    expect(currentResponse.json().account.consumed).toBe("5");
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

});
