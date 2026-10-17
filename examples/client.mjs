
const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";

async function request(path, options = {}, { allowError = false } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const body = await response.json();

  // Never print API keys.
  const safeBody = { ...body };
  if (safeBody.apiKey) safeBody.apiKey = "[REDACTED]";

  console.log(`\n${options.method ?? "GET"} ${path} -> ${response.status}`);
  console.log(JSON.stringify(safeBody, null, 2));

  if (!response.ok && !allowError) {
    throw new Error(`Request failed: ${response.status} ${path}`);
  }

  return { status: response.status, body };
}

async function main() {
  console.log("=== Usage Metering Service Demo ===");
  console.log(`API: ${baseUrl}`);

  // 1. Create one account with a small shared quota.
  const { body: account } = await request("/accounts", {
    method: "POST",
    body: JSON.stringify({
      name: `Docker Demo ${Date.now()}`,
      plan: "Starter",
    }),
  });

  if (!account.apiKey) {
    throw new Error("Account creation did not return an API key.");
  }

  const headers = { "x-api-key": account.apiKey };

  // Configure a small account quota so the shared limit is easy to demonstrate.
  const { body: accountPlanResult } = await request("/plans", {
    method: "POST",
    headers,
    body: JSON.stringify({
      scope: "account",
      name: `Demo Account Limit ${Date.now()}`,
      monthlyLimit: 12,
      maxUnitsPerRequest: 10,
    }),
  });

  const accountPlanId = accountPlanResult.plan.id;

  await request("/plans/assign/account", {
    method: "PUT",
    headers,
    body: JSON.stringify({ planId: accountPlanId }),
  });

  // 2. Create two users with different user plans.
  const { body: basicUser } = await request("/users", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Basic Demo User",
      plan: "Basic",
    }),
  });

  const { body: premiumUser } = await request("/users", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Premium Demo User",
      plan: "Premium",
    }),
  });

  async function consume(user, units, label) {
    console.log(`\n--- ${label} ---`);

    return request(
      "/usage/consume",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          userId: user.id,
          units,
          requestId: `demo-${Date.now()}-${crypto.randomUUID()}`,
        }),
      },
      { allowError: true },
    );
  }

  // 3. Accepted action: 5 units.
  await consume(basicUser, 5, "Scenario 1: accepted request");

  // 4. User limit rejection: Basic allows at most 20 units per request,
  // so configure a custom plan with a lower per-request limit.
  const { body: userPlanResult } = await request("/plans", {
    method: "POST",
    headers,
    body: JSON.stringify({
      scope: "user",
      name: `Demo Small User Limit ${Date.now()}`,
      monthlyLimit: 50,
      maxUnitsPerRequest: 3,
    }),
  });

  await request("/plans/assign/user", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      userId: basicUser.id,
      planId: userPlanResult.plan.id,
    }),
  });

  await consume(basicUser, 4, "Scenario 2: rejected by user per-request limit");

  // 5. Shared account limit rejection: the account has 7 units remaining.
  // This request is within both per-request limits, but exceeds account quota.
  await consume(premiumUser, 8, "Scenario 3: rejected by shared account monthly limit");

  // 6. Change the account plan without changing this client code.
  const { body: updatedPlanResult } = await request(
    `/plans/${accountPlanId}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        monthlyLimit: 30,
      }),
    },
  );

  console.log("\nAccount quota increased. Retrying the same type of action...");

  // A new request ID is used because a previous request ID represents a
  // previously recorded decision and cannot be reused with different data.
  await consume(premiumUser, 8, "Scenario 4: accepted after account plan update");

  // 7. Display current account and user allowances.
  await request(
    `/usage/current?userId=${encodeURIComponent(basicUser.id)}`,
    { headers },
  );

  await request(
    `/usage/current?userId=${encodeURIComponent(premiumUser.id)}`,
    { headers },
  );

  console.log("\nDemo completed.");
}

main().catch((error) => {
  console.error("Demo failed:", error.message);
  process.exitCode = 1;
});
