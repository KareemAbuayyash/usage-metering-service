const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const totalRequests = Number(process.env.LOAD_TEST_REQUESTS ?? 100);
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? 10);
if (
  !Number.isInteger(totalRequests) ||
  totalRequests < 1 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1
) {
  throw new Error("Request count and concurrency must be positive integers.");
}
async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}
async function main() {
  const account = await request("/accounts", {
    method: "POST",
    body: JSON.stringify({
      name: `Load Test ${Date.now()}`,
      plan: "Starter",
    }),
  });
  const apiKey = account.apiKey;
  if (!apiKey) throw new Error("Account creation did not return an API key.");
  const headers = { "x-api-key": apiKey };
  const user = await request("/users", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Load Test User",
      plan: "Basic",
    }),
  });
  const latencies = [];
  let nextRequest = 0;
  let failures = 0;
  const start = performance.now();
  async function worker() {
    while (true) {
      const index = nextRequest++;
      if (index >= totalRequests) return;
      const requestStart = performance.now();
      try {
        await request("/usage/consume", {
          method: "POST",
          headers,
          body: JSON.stringify({
            userId: user.id,
            units: 1,
            requestId: `load-${Date.now()}-${index}-${crypto.randomUUID()}`,
          }),
        });
        latencies.push(performance.now() - requestStart);
      } catch (error) {
        failures++;
        console.error(`Request ${index + 1} failed:`, error.message);
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, totalRequests) },
      () => worker(),
    ),
  );
  const elapsedSeconds = (performance.now() - start) / 1000;
  latencies.sort((a, b) => a - b);
  function percentile(p) {
    if (latencies.length === 0) return null;
    return Number(latencies[Math.ceil(p * latencies.length) - 1].toFixed(2));
  }
  console.log("\n--- Usage Metering Load Test ---");
  console.log(`Target URL:       ${baseUrl}`);
  console.log(`Requests planned: ${totalRequests}`);
  console.log(`Concurrency:      ${Math.min(concurrency, totalRequests)}`);
  console.log(`Successful:       ${latencies.length}`);
  console.log(`Failed:           ${failures}`);
  console.log(`Elapsed:          ${elapsedSeconds.toFixed(2)} seconds`);
  console.log(`Throughput:       ${(latencies.length / elapsedSeconds).toFixed(2)} successful requests/sec`);
  console.log(`Latency p50:      ${percentile(0.50) ?? "N/A"} ms`);
  console.log(`Latency p95:      ${percentile(0.95) ?? "N/A"} ms`);
  console.log(`Latency max:      ${latencies.length ? latencies[latencies.length - 1].toFixed(2) : "N/A"} ms`);
  if (failures > 0) process.exitCode = 1;
}
main().catch((error) => {
  console.error("Load test failed:", error.message);
  process.exitCode = 1;
});
