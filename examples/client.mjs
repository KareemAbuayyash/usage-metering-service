const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  console.log(`\n${options.method ?? "GET"} ${path} -> ${response.status}`);
  const safeBody = { ...body }; if (safeBody.apiKey) safeBody.apiKey = "[REDACTED]"; console.log(JSON.stringify(safeBody, null, 2));
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${path}`);
  }
  return body;
}
async function main() {
  const account = await request("/accounts", {
    method: "POST",
    body: JSON.stringify({
      name: "Docker Demo Account",
      plan: "Starter",
    }),
  });
  const apiKey = account.apiKey;
  if (!apiKey) {
    throw new Error("Account creation did not return an API key.");
  }
  const authHeaders = { "x-api-key": apiKey };
  const user = await request("/users", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: "Demo User",
      plan: "Basic",
    }),
  });
  await request("/usage/consume", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      userId: user.id,
      units: 5,
      requestId: `docker-demo-${Date.now()}`,
    }),
  });
  await request(
    `/usage/current?userId=${encodeURIComponent(user.id)}`,
    { headers: authHeaders },
  );
  console.log("\nDemo completed successfully.");
}
main().catch((error) => {
  console.error("Demo failed:", error.message);
  process.exitCode = 1;
});
