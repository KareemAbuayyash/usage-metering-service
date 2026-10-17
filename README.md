# Usage Metering and Quota Service

A TypeScript REST API for tracking API usage, enforcing account-level and user-level quotas, managing plans, and generating usage reports.

## Features

- Account creation with API key authentication.
- Secure API key storage using SHA-256 hashes.
- Account and user plan management.
- Built-in and custom plans.
- Usage consumption with account-level and user-level quota enforcement.
- Idempotent usage requests to prevent duplicate consumption.
- Monthly usage tracking and quota reporting.
- Paginated usage history with optional filters.
- Responsive React dashboard for managing account usage, users, plans, and request history.
- In-memory API-key connection with account creation and a one-time key reveal.
- PostgreSQL persistence and database migrations.
- Automated API tests with Vitest.
- Docker Compose setup for running the service and PostgreSQL.

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **API Framework:** Fastify
- **Database:** PostgreSQL
- **Validation:** Zod
- **Database Driver:** node-postgres (`pg`)
- **Testing:** Vitest
- **Containers:** Docker and Docker Compose
- **Frontend:** React, TypeScript, Vite, and lightweight CSS

## Architecture

The application consists of four main components:

- **Dashboard:** A responsive React application served by Nginx, with API traffic proxied to the backend.
- **API:** Handles authentication, plan management, usage consumption, and reports.
- **PostgreSQL:** Stores accounts, plans, users, usage periods, and usage requests.
- **Migration runner:** Initializes a new database schema or records an already-existing compatible schema without replacing application data.

## Getting Started

### Prerequisites

- Node.js 22 or newer and npm
- PostgreSQL 17 (or Docker Desktop with Docker Compose)

### Run with Docker Compose

Clone the repository and enter its directory:

```bash
git clone https://github.com/KareemAbuayyash/usage-metering-service.git
cd usage-metering-service
```

Start the services:

```bash
docker compose up -d --build
```

Open the dashboard at **http://localhost:4173**. The dashboard sends API requests through its same-origin `/api` proxy to the Compose backend; the browser does not use the container-only `app` hostname and no permissive CORS configuration is needed. The API remains available directly at **http://localhost:3000**.

The `example-client` container also runs the existing API demonstration and exits when finished. It creates demo accounts and usage records in the configured database. To start the dashboard and API without rerunning the demo client:

```bash
docker compose up -d --build app frontend
```

Check their status:

```bash
docker compose ps -a
```

Check the API health endpoint:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "usage-metering-service"
}
```

Check database connectivity:

```bash
curl http://localhost:3000/health/db
```

The example client demonstrates account creation, user creation, usage consumption, quota enforcement, plan limit updates, and current usage reporting. Its container exits after completing the example.

The frontend listens on port `4173`. To change the API base path used by its built bundle, set `VITE_API_BASE_URL` before building; keep the default `/api` when using the Compose Nginx proxy.

View service logs:

```bash
docker compose logs app
docker compose logs migrate example-client
```

### Stop the Services

```bash
docker compose down
```

This stops and removes the Compose containers and network while preserving the named PostgreSQL volume.

**Do not use `docker compose down -v` if you need to preserve the database volume.**
`POSTGRES_PASSWORD` is configurable through the root `.env`; its default matches the existing local development credential. Changing this variable does not rotate the password stored in an already-initialized PostgreSQL volume. Keep it consistent with that volume's existing credential; this setup does not recreate the volume or rotate credentials.

## Configuration

The backend reads its environment variables from the repository-root `.env`.

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | HTTP server port |
| `NODE_ENV` | Application environment |
| `POSTGRES_PASSWORD` | Local Compose PostgreSQL password (default: `local_dev_password`); keep in sync with the existing database volume |
| `VITE_API_BASE_URL` | Frontend API base path; defaults to `/api` for the proxy |
| `VITE_PROXY_TARGET` | Backend URL used by the local Vite development proxy (default: `http://localhost:3000`) |

Use `.env.example` as a reference for local configuration. Never commit `.env` files, real API keys, or production credentials.
The frontend reads its own variables from `frontend/.env`; use `frontend/.env.example` as the local reference. `VITE_API_BASE_URL` is compiled into the frontend bundle, and `VITE_PROXY_TARGET` is used only by the Vite development server. Compose defaults to the same-origin `/api` proxy.

Docker Compose supplies the database connection settings to its containers through their environment.

## API Endpoints

The API listens on port `3000` by default.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Check API health |
| GET | `/health/db` | Check database connectivity |
| POST | `/accounts` | Create an account and issue an API key |
| GET | `/users` | List users and current-month usage in the authenticated account |
| POST | `/users` | Create a user within the authenticated account |
| GET | `/plans` | List available plans |
| POST | `/plans` | Create a custom plan |
| GET | `/plans/:planId` | Retrieve a plan |
| PATCH | `/plans/:planId` | Update a custom plan |
| PUT | `/plans/assign/account` | Assign a plan to an account |
| PUT | `/plans/assign/user` | Assign a plan to a user |
| POST | `/usage/consume` | Record a usage request and enforce quotas |
| GET | `/usage/current` | Retrieve current-month usage |
| GET | `/usage/monthly` | Retrieve historical monthly usage and request outcomes |
| GET | `/usage/history` | Retrieve paginated usage history |

Authenticated endpoints use the `x-api-key` HTTP header:

```http
x-api-key: YOUR_API_KEY
```

Account-scoped resources are isolated by the authenticated account.

### Connect to the Dashboard

On **http://localhost:4173**, enter an existing account API key to connect. The dashboard validates it against the plans endpoint before opening the workspace. Keys remain in React memory only and are cleared when you disconnect or close/reload the page.

If you do not have an account, use **Create an account** on the connection screen. Choose Starter or Pro, then copy the returned API key and save it securely before continuing: the backend returns it only once. The dashboard never stores the key in local storage or sends it to any service other than the configured API.

The dashboard includes account usage and quota cards; account-scoped user creation and plan assignment; built-in and custom plan management; usage submission with unique idempotency IDs and safe same-ID retries; and filtered, paginated usage history.

### Create an Account

**Request**

```http
POST /accounts
Content-Type: application/json
```

```json
{
  "name": "Example Account",
  "plan": "Starter"
}
```

A successful request returns `201 Created` and includes the newly issued API key. Store it securely because it is only returned when the account is created.

### Create a User

**Request**

```http
POST /users
Content-Type: application/json
x-api-key: YOUR_API_KEY
```

```json
{
  "name": "Example User",
  "plan": "Basic"
}
```

### Consume Usage

**Request**

```http
POST /usage/consume
Content-Type: application/json
x-api-key: YOUR_API_KEY
```

```json
{
  "userId": "USER_UUID",
  "units": 5,
  "requestId": "unique-request-001"
}
```

The service checks both account-level and user-level quotas before accepting usage.

The `requestId` supports idempotency: repeating the same request ID with the same payload does not consume usage twice. Reusing it with a different payload returns a conflict.

Requests that exceed the maximum units per request or the monthly quota are rejected with the appropriate error response.

An accepted response (`200 OK`) includes `allowed: true`, the request ID and units, and the updated account and user usage counters. A quota rejection (`429 Too Many Requests`) includes `allowed: false`, plus `reason` and `scope`:

```json
{
  "allowed": true,
  "requestId": "unique-request-001",
  "units": 5,
  "accountUsage": {
    "consumed": 5,
    "limit": 10000
  },
  "userUsage": {
    "consumed": 5,
    "limit": 1000
  }
}
```

```json
{
  "allowed": false,
  "requestId": "unique-request-001",
  "units": 5,
  "scope": "account",
  "reason": "MONTHLY_LIMIT_EXCEEDED"
}
```

A reused request ID with a different user or unit count returns `409 Conflict`:

```json
{
  "error": "IDEMPOTENCY_CONFLICT",
  "message": "This request ID was already used with different data."
}
```

Invalid request bodies or query parameters return `400 Bad Request` with `error: "VALIDATION_ERROR"` and a `details` array. Missing or invalid API keys return `401 Unauthorized` with `error: "UNAUTHORIZED"`.

### Get Current Usage

**Request**

```http
GET /usage/current?userId=USER_UUID
x-api-key: YOUR_API_KEY
```

The report includes consumed units, configured limits, remaining quota, and maximum units per request for the account and user.

### Get Historical Monthly Usage

**Request**

```http
GET /usage/monthly?month=2026-09&userId=USER_UUID
x-api-key: YOUR_API_KEY
```

`month` is required in `YYYY-MM` format; `userId` is optional and must belong to the authenticated account. The account totals are always returned, and the user's totals are included when a user ID is supplied:

```json
{
  "monthStart": "2026-09-01",
  "account": {
    "consumed": "5",
    "acceptedRequests": 1,
    "rejectedRequests": 1
  },
  "user": {
    "id": "USER_UUID",
    "name": "Example User",
    "consumed": "5",
    "acceptedRequests": 1,
    "rejectedRequests": 1
  }
}
```

Historical request counts include accepted and rejected records for that UTC calendar month. Historical plan assignments are not stored, so the service cannot reliably calculate a past month's quota limit or remaining units after plans change; use `/usage/current` for current limits and remaining quota.

### Get Usage History

**Request**

```http
GET /usage/history?page=1&limit=5&status=accepted&userId=USER_UUID&month=2026-09
x-api-key: YOUR_API_KEY
```

Pagination parameters include `page` and `limit`. Optional filters include `status`, `userId`, and UTC calendar `month` (`YYYY-MM`). The response contains a `data` array of request records and `pagination` metadata:

```json
{
  "data": [
    {
      "request_id": "unique-request-001",
      "user_id": "USER_UUID",
      "user_name": "Example User",
      "units": "5",
      "status": "accepted",
      "rejection_scope": null,
      "rejection_reason": null,
      "created_at": "2026-09-12T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  }
}
```

The dashboard's History section supports month, status, and user filters and shows the selected month's account and (when selected) user consumption and request outcome totals.

## Assumptions and Limitations

- Quota periods are UTC calendar months, and usage is measured in integer units supplied by the caller.
- The API key identifies and scopes an account; there are no separate end-user credentials or role-based permissions.
- Request IDs are unique within an account. Identical retries replay the original outcome, while a changed payload using the same ID is a conflict.
- Account and user monthly limits are enforced independently. Changing a plan affects future consumption checks and does not reset or remove already-recorded usage.
- Built-in plans are shared defaults; custom plans belong to the creating account and can only be assigned within that account.
- Historical request and consumption records are retained, but plan assignments are not versioned. Therefore past quota limits and remaining balances cannot be reconstructed after plan changes.
- This project demonstrates metering and quota enforcement; it does not provide billing, refunds, chargebacks, end-user authentication, or distributed multi-region quota coordination.

## Built-in Plans

The default seeded plans are:

| Scope | Plan | Monthly Quota | Maximum Units per Request |
|---|---|---:|---:|
| Account | Starter | 10,000 | 100 |
| Account | Pro | 100,000 | 1,000 |
| User | Basic | 1,000 | 20 |
| User | Premium | 10,000 | 100 |

Monthly usage periods use UTC calendar months. Requests exceeding the per-request limit are rejected, and monthly quota violations are recorded as rejected usage attempts.

The service also supports custom plans and plan assignments through the API.

### Concurrent Quota Enforcement

Concurrent usage requests are checked against both the shared account monthly quota and the individual user's monthly quota. Automated tests submit requests concurrently at each scope and verify that accepted usage stays within the applicable monthly limit; requests beyond the remaining quota are rejected without increasing consumed usage.

## Local Development

Install backend dependencies:

```bash
npm ci
```

Start PostgreSQL with Compose (or use an existing PostgreSQL instance):

```powershell
docker compose up -d db
```

Create the backend environment file once, then configure `DATABASE_URL` and `POSTGRES_PASSWORD` as needed. The example password is for local development only; the Compose database and local application connection must use matching credentials:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Initialize or verify the schema and start the API:

```bash
node scripts/migrate.mjs
npm run dev
```

In a second terminal, install and start the frontend:

```powershell
Set-Location frontend
Copy-Item .env.example .env
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to `VITE_PROXY_TARGET` (default `http://localhost:3000`); set that variable in `frontend/.env` if your local backend listens elsewhere. No API key is written to disk.

Build the project:

```bash
npm run build
```

Run automated tests:

```bash
npm test
```

Build the frontend:

```powershell
Set-Location frontend
npm run build
```

The test suite uses a dedicated test database. Configure its connection according to `tests/setup.ts` and ensure PostgreSQL is running before executing database integration tests.

## Docker Demo

To inspect the example client's output when it is run by the full Compose startup:

```bash
docker compose logs example-client
```

The demo illustrates account and user creation, usage consumption, per-request limit enforcement, account quota enforcement, updating a plan limit, and retrieving current usage.

The example client container exits after the demo completes. This is expected behavior.

To rebuild and start the dashboard and API without rerunning the example client, use `docker compose up -d --build app frontend`. The frontend is available at **http://localhost:4173**. `docker compose down` preserves the named PostgreSQL volume; do not use `docker compose down -v` if the database must be retained.

## Security Notes

- API keys are returned at account creation and should be stored securely.
- The database stores API key hashes rather than plaintext API keys.
- Never commit `.env` files, credentials, or production secrets.
- Use strong, externally managed credentials and appropriate secret management for production deployments.
- Review database access, network exposure, and operational monitoring before production use.

The credentials in `.env.example` are intended for local development only and must not be reused in production.

## Performance Testing

A basic local load test is available at `scripts/load-test.mjs`.

**Database side effects:** This script creates an account, a user, and usage request records, and does not clean them up afterward. Run it against a suitable test or demo database, not a database containing important data. The script does not automatically delete any generated records.

Run it while the API is running:

```bash
node scripts/load-test.mjs
```

Optional environment variables:

- `LOAD_TEST_REQUESTS`: Number of usage requests (default: `100`).
- `LOAD_TEST_CONCURRENCY`: Number of concurrent workers (default: `10`).
- `API_BASE_URL`: API base URL (default: `http://localhost:3000`).

Example PowerShell commands with custom settings:

```powershell
$env:LOAD_TEST_REQUESTS = "500"
$env:LOAD_TEST_CONCURRENCY = "20"

node scripts/load-test.mjs

Remove-Item Env:LOAD_TEST_REQUESTS
Remove-Item Env:LOAD_TEST_CONCURRENCY
```

### Initial Local Baseline

Environment: local API and PostgreSQL running through Docker Compose.

| Metric | Result |
|---|---:|
| Requests planned | 100 |
| Concurrent workers | 10 |
| Successful requests | 100 |
| Failed requests | 0 |
| Elapsed time | 0.67 seconds |
| Throughput | 148.36 successful requests/second |
| Median latency (p50) | 62.40 ms |
| 95th percentile latency (p95) | 89.09 ms |
| Maximum latency | 123.97 ms |

These measurements come from one local run and are not a production capacity guarantee. Results vary with hardware, database state, environment, and workload. Repeat the test under controlled conditions before making performance claims.

This run demonstrates that the sample workload completed without request failures and provides a baseline of roughly 148 requests per second with a p95 latency below 90 ms on that local setup. It does not measure saturation or establish production capacity. Usage requests for one account are serialized by the account-row lock, so contention on a heavily used account is a reasonable area for a larger, controlled follow-up benchmark; this single-account sample does not quantify that limit.

## License

No license has been specified yet.
