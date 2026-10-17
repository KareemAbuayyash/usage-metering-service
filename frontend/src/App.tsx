import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ApiClient,
  ApiError,
  isUsageRejection,
  type CurrentUsage,
  type History,
  type Plan,
  type User,
} from "./api";

type Section = "Overview" | "Users" | "Plans" | "Consume usage" | "History";
type Notice = { kind: "success" | "error"; text: string };

const sections: Section[] = [
  "Overview",
  "Users",
  "Plans",
  "Consume usage",
  "History",
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function formattedUnits(value: string | number): string {
  return Number(value).toLocaleString();
}

function todayLabel(): string {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

function Loading() {
  return (
    <div className="loading-state" role="status">
      <span className="spinner" />
      <span>Loading your account data...</span>
    </div>
  );
}

function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">--</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function AuthScreen({
  onConnect,
  notify,
}: {
  onConnect: (key: string) => void;
  notify: (notice: Notice) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountPlan, setAccountPlan] = useState("Starter");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const client = useMemo(() => new ApiClient("", () => undefined), []);

  async function connect(event: FormEvent) {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key) {
      setError("Enter an API key to continue.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await new ApiClient(key, () => undefined).listPlans();
      onConnect(key);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await client.createAccount(accountName.trim(), accountPlan);
      setCreatedKey(result.apiKey);
      setApiKey(result.apiKey);
      notify({ kind: "success", text: "Account created. Copy and save your API key before continuing." });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      notify({ kind: "success", text: "API key copied to clipboard." });
    } catch {
      notify({ kind: "error", text: "Clipboard access was blocked. Select and copy the key shown above." });
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-intro">
        <div className="brand brand-large">
          <span className="brand-symbol"><i /><i /><i /></span>
          <span>meterwise</span>
        </div>
        <div className="auth-copy">
          <span className="eyebrow">USAGE METERING, MADE CLEAR</span>
          <h1>Know exactly where every unit goes.</h1>
          <p>Monitor account quotas, manage plans, and keep your usage on track from one simple workspace.</p>
          <div className="auth-proof">
            <span className="proof-check">✓</span>
            <span>Account-scoped data, secured by your API key</span>
          </div>
        </div>
        <span className="auth-orbit orbit-one" />
        <span className="auth-orbit orbit-two" />
        <span className="auth-footer">USAGE METERING &nbsp; / &nbsp; QUOTA MANAGEMENT</span>
      </section>

      <section className="auth-panel">
        <div className="auth-forms">
          <div className="mobile-brand brand">
            <span className="brand-symbol"><i /><i /><i /></span>
            <span>meterwise</span>
          </div>
          {createdKey ? (
            <div className="key-reveal">
              <span className="eyebrow">ACCOUNT READY</span>
              <h2>One last thing.</h2>
              <p>Your API key is shown only once. Copy it and keep it somewhere safe.</p>
              <div className="api-key-box">
                <code>{createdKey}</code>
                <button className="button button-light button-small" type="button" onClick={copyKey}>Copy key</button>
              </div>
              <div className="warning-note">
                <strong>Save this key now</strong>
                <span>It cannot be recovered after you leave this screen.</span>
              </div>
              <button className="button button-primary button-full" type="button" onClick={() => onConnect(createdKey)}>
                Continue to dashboard <span aria-hidden="true">→</span>
              </button>
            </div>
          ) : (
            <>
              <div className="form-heading">
                <span className="eyebrow">SECURE ACCOUNT CONNECTION</span>
                <h2>Reconnect to Meterwise</h2>
                <p>After a page refresh, your API key is cleared by design. Paste your existing key again to reconnect and load fresh account data.</p>
              </div>
              <form className="auth-form" onSubmit={connect}>
                <label htmlFor="api-key">Paste your existing API key</label>
                <input
                  id="api-key"
                  autoFocus
                  autoComplete="off"
                  type="password"
                  placeholder="ums_..."
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  aria-describedby="api-key-session-note"
                />
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="button button-primary button-full" disabled={busy}>
                  {busy ? "Verifying key..." : "Reconnect and load dashboard"}
                </button>
              </form>
              <div className="form-divider"><span>NEW HERE?</span></div>
              <form className="auth-form create-account-form" onSubmit={createAccount}>
                <label htmlFor="account-name">Create an account</label>
                <input
                  id="account-name"
                  minLength={2}
                  maxLength={150}
                  placeholder="Your team or company"
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                  required
                />
                <div className="form-row">
                  <label htmlFor="account-plan">Starting plan</label>
                  <select id="account-plan" value={accountPlan} onChange={(event) => setAccountPlan(event.target.value)}>
                    <option>Starter</option>
                    <option>Pro</option>
                  </select>
                </div>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="button button-outline button-full" disabled={busy}>
                  {busy ? "Creating account..." : "Create account & get an API key"}
                </button>
              </form>
              <p className="privacy-note" id="api-key-session-note">For your security, the API key stays in memory only. It is cleared when you refresh or disconnect. Paste it here again to reconnect; it is never saved in browser storage.</p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function DashboardPage({
  api,
  onNavigate,
}: {
  api: ApiClient;
  onNavigate: (section: Section) => void;
}) {
  const [usage, setUsage] = useState<CurrentUsage | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [recentHistory, setRecentHistory] = useState<History["data"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [current, userResult, history] = await Promise.all([
        api.getCurrentUsage(),
        api.listUsers(),
        api.getHistory({ page: 1, limit: 5 }),
      ]);
      setUsage(current);
      setUsers(userResult.users);
      setRecentHistory(history.data);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Loading />;
  if (error) {
    return <EmptyState title="We could not load your overview" detail={error} action={<button className="button button-light" onClick={() => void load()}>Try again</button>} />;
  }
  if (!usage) return null;

  const account = usage.account;
  const limit = Number(account.limit);
  const consumed = Number(account.consumed);
  const percent = limit > 0 ? Math.min((consumed / limit) * 100, 100) : 0;

  return (
    <>
      <div className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">ACCOUNT OVERVIEW</span>
          <h1>Good to see you.</h1>
          <p>Here is how your account is doing this month.</p>
        </div>
        <span className="date-chip"><span className="date-dot" /> {todayLabel()}</span>
      </div>

      <section className="usage-hero">
        <div className="usage-hero-top">
          <div>
            <span className="overline-light">MONTHLY ACCOUNT USAGE</span>
            <div className="usage-number">{formattedUnits(account.consumed)} <span>/ {formattedUnits(account.limit)}</span></div>
            <p className="hero-caption">{formattedUnits(account.remaining)} units remaining this month</p>
          </div>
          <div className="hero-plan">
            <span className="plan-emblem">M</span>
            <span><small>Current plan</small><strong>{account.plan}</strong></span>
          </div>
        </div>
        <div className="progress-track"><span style={{ width: `${percent}%` }} /></div>
        <div className="progress-labels"><span>{percent.toFixed(1)}% used</span><span>Resets {new Date(`${account.monthStart}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })} · {formattedUnits(account.maxUnitsPerRequest)} max per request</span></div>
      </section>

      <section className="stat-grid">
        <article className="stat-card">
          <div className="stat-top"><span>ACTIVE USERS</span><span className="stat-glyph glyph-violet">U</span></div>
          <strong>{users.length}</strong><p>on this account</p>
          <button className="text-link" onClick={() => onNavigate("Users")}>Manage users <span>→</span></button>
        </article>
        <article className="stat-card">
          <div className="stat-top"><span>REQUEST LIMIT</span><span className="stat-glyph glyph-blue">↗</span></div>
          <strong>{formattedUnits(account.maxUnitsPerRequest)}</strong><p>units per request</p>
          <button className="text-link" onClick={() => onNavigate("Plans")}>Explore plans <span>→</span></button>
        </article>
        <article className="stat-card">
          <div className="stat-top"><span>RECENT ACTIVITY</span><span className="stat-glyph glyph-orange">↻</span></div>
          <strong>{recentHistory.length ? recentHistory.length : "—"}</strong><p>latest requests shown below</p>
          <button className="text-link" onClick={() => onNavigate("History")}>View all history <span>→</span></button>
        </article>
      </section>

      <section className="panel activity-panel">
        <div className="panel-heading">
          <div><h2>Recent activity</h2><p>Your latest usage requests</p></div>
          <button className="button button-light button-small" onClick={() => onNavigate("History")}>Full history <span>→</span></button>
        </div>
        {recentHistory.length === 0 ? (
          <EmptyState title="No usage requests yet" detail="Your recent activity will appear here after the first request." action={<button className="button button-primary button-small" onClick={() => onNavigate("Consume usage")}>Record usage</button>} />
        ) : <HistoryTable rows={recentHistory} />}
      </section>
    </>
  );
}

function UsersPage({
  api,
  notify,
}: {
  api: ApiClient;
  notify: (notice: Notice) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [name, setName] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("");
  const [assignment, setAssignment] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [userResult, planResult] = await Promise.all([api.listUsers(), api.listPlans()]);
      setUsers(userResult.users);
      setPlans(planResult.plans.filter((plan) => plan.scope === "user"));
      setAssignment(Object.fromEntries(userResult.users.map((user) => [user.id, user.plan])));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.createUser(name.trim(), selectedPlan || "Basic");
      setName("");
      notify({ kind: "success", text: "User created successfully." });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function assignPlan(user: User) {
    const plan = plans.find((item) => item.name === assignment[user.id]);
    if (!plan || plan.name === user.plan) return;
    setBusy(true);
    try {
      await api.assignUserPlan(user.id, plan.id);
      notify({ kind: "success", text: `${user.name}'s plan is now ${plan.name}.` });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const availablePlans = plans.filter((plan) => plan.is_builtin);

  return (
    <>
      <div className="page-heading">
        <div><span className="eyebrow">ACCOUNT MEMBERS</span><h1>Users</h1><p>Manage your account users and their monthly allowances.</p></div>
        <span className="count-chip">{users.length} {users.length === 1 ? "user" : "users"}</span>
      </div>

      <section className="panel create-panel">
        <div className="panel-heading">
          <div><h2>Add a user</h2><p>New users belong to this account only.</p></div>
          <span className="section-number">01</span>
        </div>
        <form className="inline-form" onSubmit={createUser}>
          <div className="field-grow"><label htmlFor="new-user-name">Name</label><input id="new-user-name" minLength={2} maxLength={150} placeholder="e.g. Jordan Lee" value={name} onChange={(event) => setName(event.target.value)} required /></div>
          <div className="field-medium"><label htmlFor="new-user-plan">Starting plan</label><select id="new-user-plan" value={selectedPlan || "Basic"} onChange={(event) => setSelectedPlan(event.target.value)}>{availablePlans.map((plan) => <option key={plan.id} value={plan.name}>{plan.name} · {formattedUnits(plan.monthly_limit)} units</option>)}</select></div>
          <button className="button button-primary form-action" disabled={busy || availablePlans.length === 0}>{busy ? "Saving..." : "Add user"} <span>+</span></button>
        </form>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Your users</h2><p>Usage resets with the UTC calendar month.</p></div></div>
        {error && <div className="inline-error" role="alert">{error}<button onClick={() => void load()}>Retry</button></div>}
        {loading ? <Loading /> : users.length === 0 ? (
          <EmptyState title="No users yet" detail="Add your first user above to get started." />
        ) : (
          <div className="table-scroll"><table>
            <thead><tr><th>USER</th><th>PLAN</th><th>THIS MONTH</th><th>REMAINING</th><th>CHANGE PLAN</th></tr></thead>
            <tbody>{users.map((user) => {
              const percent = Number(user.usage.limit) > 0 ? Math.min(Number(user.usage.consumed) / Number(user.usage.limit) * 100, 100) : 0;
              return <tr key={user.id}>
                <td><div className="user-cell"><span className="avatar">{user.name.trim().slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.id.slice(0, 8)}...</small></span></div></td>
                <td><span className="plan-tag">{user.plan}</span></td>
                <td><div className="usage-cell"><span>{formattedUnits(user.usage.consumed)} <small>/ {formattedUnits(user.usage.limit)}</small></span><span className="mini-progress"><i style={{ width: `${percent}%` }} /></span></div></td>
                <td>{formattedUnits(user.usage.remaining)}</td>
                <td><div className="table-action"><select aria-label={`Plan for ${user.name}`} value={assignment[user.id] ?? user.plan} onChange={(event) => setAssignment((current) => ({ ...current, [user.id]: event.target.value }))}>{plans.map((plan) => <option key={plan.id} value={plan.name}>{plan.name}{!plan.is_builtin ? " · custom" : ""}</option>)}</select><button className="button button-light button-small" disabled={busy || assignment[user.id] === user.plan} onClick={() => void assignPlan(user)}>Save</button></div></td>
              </tr>;
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}

function PlansPage({
  api,
  notify,
}: {
  api: ApiClient;
  notify: (notice: Notice) => void;
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [usage, setUsage] = useState<CurrentUsage | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"account" | "user">("account");
  const [monthlyLimit, setMonthlyLimit] = useState("1000");
  const [maxRequest, setMaxRequest] = useState("100");
  const [accountPlanId, setAccountPlanId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [editLimit, setEditLimit] = useState("");
  const [editMax, setEditMax] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [planResult, current] = await Promise.all([api.listPlans(), api.getCurrentUsage()]);
      setPlans(planResult.plans);
      setUsage(current);
      const currentPlan = planResult.plans.find((plan) => plan.scope === "account" && plan.name === current.account.plan);
      setAccountPlanId(currentPlan?.id ?? "");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function createPlan(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.createPlan({
        scope,
        name: name.trim(),
        monthlyLimit: Number(monthlyLimit),
        maxUnitsPerRequest: Number(maxRequest),
      });
      setName("");
      notify({ kind: "success", text: "Custom plan created." });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.updatePlan(editingId, {
        name: editName.trim(),
        monthlyLimit: Number(editLimit),
        maxUnitsPerRequest: Number(editMax),
      });
      setEditingId("");
      notify({ kind: "success", text: "Plan updated. Existing usage is unchanged." });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function assignAccountPlan() {
    if (!accountPlanId) return;
    setBusy(true);
    try {
      await api.assignAccountPlan(accountPlanId);
      notify({ kind: "success", text: "Account plan updated. Existing usage remains unchanged." });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(plan: Plan) {
    setEditingId(plan.id);
    setEditName(plan.name);
    setEditLimit(String(plan.monthly_limit));
    setEditMax(String(plan.max_units_per_request));
  }

  const accountPlans = plans.filter((plan) => plan.scope === "account");
  const userPlans = plans.filter((plan) => plan.scope === "user");

  function planGroup(title: string, items: Plan[]) {
    return (
      <section className="panel plans-panel">
        <div className="panel-heading"><div><h2>{title}</h2><p>{items.filter((plan) => plan.is_builtin).length} built-in · {items.filter((plan) => !plan.is_builtin).length} custom</p></div></div>
        {items.length === 0 ? <EmptyState title="No plans available" detail="Create a custom plan to get started." /> : (
          <div className="plans-grid">{items.map((plan) => <article className={`plan-card ${plan.is_builtin ? "plan-card-builtin" : "plan-card-custom"}`} key={plan.id}>
            <div className="plan-card-head"><span className={`plan-kind ${plan.is_builtin ? "kind-builtin" : "kind-custom"}`}>{plan.is_builtin ? "BUILT-IN" : "CUSTOM"}</span>{!plan.is_builtin && <button className="icon-button" title="Edit custom plan" onClick={() => startEdit(plan)}>Edit</button>}</div>
            <h3>{plan.name}</h3>
            <div className="plan-quota">{formattedUnits(plan.monthly_limit)} <span>units / month</span></div>
            <div className="plan-detail"><span>Maximum per request</span><strong>{formattedUnits(plan.max_units_per_request)}</strong></div>
            {!plan.is_builtin && editingId === plan.id && (
              <form className="edit-plan-form" onSubmit={(event) => void saveEdit(event)}>
                <label>Plan name<input minLength={2} maxLength={100} value={editName} onChange={(event) => setEditName(event.target.value)} required /></label>
                <div className="form-row"><label>Monthly units<input type="number" min="1" step="1" value={editLimit} onChange={(event) => setEditLimit(event.target.value)} required /></label><label>Max / request<input type="number" min="1" step="1" value={editMax} onChange={(event) => setEditMax(event.target.value)} required /></label></div>
                <div className="button-row"><button className="button button-primary button-small" disabled={busy}>Save changes</button><button className="button button-light button-small" type="button" onClick={() => setEditingId("")}>Cancel</button></div>
              </form>
            )}
          </article>)}</div>
        )}
      </section>
    );
  }

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">QUOTA CONFIGURATION</span><h1>Plans</h1><p>Built-in allowances and custom plans for your account.</p></div></div>
      {error && <div className="inline-error" role="alert">{error}<button onClick={() => void load()}>Retry</button></div>}
      {loading ? <Loading /> : <>
        <section className="panel account-plan-panel">
          <div className="panel-heading"><div><h2>Account plan</h2><p>Applies to the total usage shared by all users.</p></div><span className="active-plan-label">CURRENT: {usage?.account.plan ?? "—"}</span></div>
          <div className="inline-form account-plan-form">
            <div className="field-grow"><label htmlFor="account-plan-select">Assign account plan</label><select id="account-plan-select" value={accountPlanId} onChange={(event) => setAccountPlanId(event.target.value)}>{accountPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {formattedUnits(plan.monthly_limit)} units{plan.is_builtin ? "" : " · custom"}</option>)}</select></div>
            <button className="button button-primary form-action" disabled={busy || !accountPlanId || accountPlanId === accountPlans.find((plan) => plan.name === usage?.account.plan)?.id} onClick={() => void assignAccountPlan()}>Apply plan <span>→</span></button>
          </div>
        </section>
        {planGroup("Account plans", accountPlans)}
        {planGroup("User plans", userPlans)}
        <section className="panel create-plan-panel">
          <div className="panel-heading"><div><h2>Create a custom plan</h2><p>Custom plans are private to this account. Built-in plans cannot be edited.</p></div><span className="section-number">+</span></div>
          <form className="plan-create-form" onSubmit={(event) => void createPlan(event)}>
            <div className="field-grow"><label htmlFor="custom-plan-name">Plan name</label><input id="custom-plan-name" minLength={2} maxLength={100} placeholder="e.g. Growth" value={name} onChange={(event) => setName(event.target.value)} required /></div>
            <div className="field-medium"><label htmlFor="custom-plan-scope">Applies to</label><select id="custom-plan-scope" value={scope} onChange={(event) => setScope(event.target.value === "user" ? "user" : "account")}><option value="account">Account</option><option value="user">User</option></select></div>
            <div className="field-medium"><label htmlFor="custom-plan-limit">Monthly units</label><input id="custom-plan-limit" type="number" min="1" step="1" value={monthlyLimit} onChange={(event) => setMonthlyLimit(event.target.value)} required /></div>
            <div className="field-medium"><label htmlFor="custom-plan-max">Max per request</label><input id="custom-plan-max" type="number" min="1" step="1" value={maxRequest} onChange={(event) => setMaxRequest(event.target.value)} required /></div>
            <button className="button button-primary form-action" disabled={busy}>{busy ? "Saving..." : "Create plan"} <span>+</span></button>
          </form>
        </section>
      </>}
    </>
  );
}

type ConsumeOperation = { userId: string; units: number; requestId: string };
type ConsumeDisplay = {
  allowed: boolean;
  requestId: string;
  units: number;
  scope?: string;
  reason?: string;
  replayed?: boolean;
  accountUsage?: { consumed: string | number; limit: string | number };
};

function ConsumePage({
  api,
  notify,
}: {
  api: ApiClient;
  notify: (notice: Notice) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [units, setUnits] = useState("1");
  const [usage, setUsage] = useState<CurrentUsage | null>(null);
  const [result, setResult] = useState<ConsumeDisplay | null>(null);
  const [retryOperation, setRetryOperation] = useState<ConsumeOperation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userResult, current] = await Promise.all([api.listUsers(), api.getCurrentUsage()]);
      setUsers(userResult.users);
      setUsage(current);
      setSelectedUser((value) => value || userResult.users[0]?.id || "");
      setError("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function submitOperation(operation: ConsumeOperation) {
    setBusy(true);
    setError("");
    try {
      const response = await api.consume(operation.userId, operation.requestId, operation.units);
      setResult(response);
      setRetryOperation(null);
      notify({ kind: "success", text: response.replayed ? "This request was already recorded; usage was not charged twice." : "Usage request accepted." });
      try {
        const [current, userResult] = await Promise.all([
          api.getCurrentUsage(),
          api.listUsers(),
        ]);
        setUsage(current);
        setUsers(userResult.users);
      } catch {
        setError("The request was recorded, but updated usage could not be loaded.");
      }
    } catch (cause) {
      if (cause instanceof ApiError && isUsageRejection(cause.payload)) {
        setResult(cause.payload);
        setRetryOperation(null);
        notify({ kind: "error", text: `Usage rejected: ${cause.payload.reason.replaceAll("_", " ").toLowerCase()}.` });
      } else {
        setError(errorMessage(cause));
        if (!(cause instanceof ApiError) || cause.status >= 500) {
          setRetryOperation(operation);
        } else {
          setRetryOperation(null);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedUser || !Number.isSafeInteger(Number(units)) || Number(units) < 1) {
      setError("Select a user and enter a positive whole number of units.");
      return;
    }
    setResult(null);
    setRetryOperation(null);
    void submitOperation({
      userId: selectedUser,
      units: Number(units),
      requestId: `usage-${crypto.randomUUID()}`,
    });
  }

  const selected = users.find((user) => user.id === selectedUser);

  if (loading) return <Loading />;
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">RECORD AN OPERATION</span><h1>Consume usage</h1><p>Submit units for a user. The account and user limits are checked together.</p></div></div>
      {error && <div className="inline-error" role="alert">{error}</div>}
      {users.length === 0 ? (
        <section className="panel"><EmptyState title="Create a user first" detail="Usage requests are associated with an account user. Add one in the Users section, then come back here." /></section>
      ) : (
        <div className="consume-layout">
          <section className="panel consume-panel">
            <div className="panel-heading"><div><h2>New usage request</h2><p>Each operation gets a unique idempotency key.</p></div><span className="section-number">01</span></div>
            <form className="consume-form" onSubmit={submit}>
              <label htmlFor="consume-user">User</label>
              <select id="consume-user" value={selectedUser} disabled={busy || Boolean(retryOperation)} onChange={(event) => setSelectedUser(event.target.value)}>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.plan}</option>)}</select>
              <div className="consume-user-usage">
                <div><span>MONTHLY USAGE</span><strong>{formattedUnits(selected?.usage.consumed ?? "0")} <small>/ {formattedUnits(selected?.usage.limit ?? "0")}</small></strong></div>
                <div><span>AVAILABLE</span><strong>{formattedUnits(selected?.usage.remaining ?? "0")}</strong></div>
              </div>
              <label htmlFor="consume-units">Units to consume</label>
              <input id="consume-units" type="number" min="1" max="9007199254740991" step="1" value={units} disabled={busy || Boolean(retryOperation)} onChange={(event) => setUnits(event.target.value)} required />
              <div className="limit-hint">Account limit: {formattedUnits(usage?.account.remaining ?? "0")} remaining · Max {formattedUnits(usage?.account.maxUnitsPerRequest ?? "0")} per request</div>
              {retryOperation ? (
                <div className="retry-card">
                  <p>We did not receive a confirmation. Retry the <strong>same request ID</strong> to avoid charging twice.</p>
                  <code>{retryOperation.requestId}</code>
                  <div className="button-row"><button type="button" className="button button-primary" disabled={busy} onClick={() => void submitOperation(retryOperation)}>{busy ? "Retrying..." : "Retry same request"}</button><button type="button" className="button button-light" disabled={busy} onClick={() => { setRetryOperation(null); setError(""); }}>Start a new request</button></div>
                </div>
              ) : (
                <button className="button button-primary button-full" disabled={busy || !selectedUser}>{busy ? "Submitting..." : "Submit usage request"} <span>→</span></button>
              )}
            </form>
          </section>
          <aside className="consume-aside">
            <div className="aside-icon">i</div>
            <h3>Safe by design</h3>
            <p>Each request is recorded with a unique ID. If a connection drops, retry the same operation using its original ID to prevent double counting.</p>
            <div className="aside-rule" />
            <span className="aside-label">MONTHLY RESET</span>
            <strong>{new Date().toLocaleDateString("en", { month: "long", timeZone: "UTC" })}</strong>
            <span className="aside-small">Usage is tracked by UTC calendar month.</span>
          </aside>
        </div>
      )}
      {result && <section className={`result-card ${result.allowed ? "result-accepted" : "result-rejected"}`}>
        <div className="result-icon">{result.allowed ? "✓" : "!"}</div>
        <div className="result-copy"><span className="eyebrow">{result.allowed ? "REQUEST ACCEPTED" : "REQUEST REJECTED"}</span><h2>{result.allowed ? `${formattedUnits(result.units)} units recorded` : result.reason?.replaceAll("_", " ").toLowerCase()}</h2><p>{result.allowed ? "The operation was added to account usage." : `The ${result.scope ?? "account"} quota does not allow this request.`}</p><code>Request ID: {result.requestId}</code></div>
        {result.accountUsage && <div className="result-usage"><span>ACCOUNT TOTAL</span><strong>{formattedUnits(result.accountUsage.consumed)} / {formattedUnits(result.accountUsage.limit)}</strong></div>}
      </section>}
    </>
  );
}

function HistoryTable({ rows }: { rows: History["data"] }) {
  return (
    <div className="table-scroll"><table>
      <thead><tr><th>REQUEST</th><th>USER</th><th>UNITS</th><th>STATUS</th><th>DETAIL</th><th>DATE</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={`${row.request_id}-${row.created_at}`}>
        <td><code className="request-id">{row.request_id}</code></td>
        <td><strong>{row.user_name}</strong></td>
        <td>{formattedUnits(row.units)}</td>
        <td><span className={`status-pill ${row.status === "accepted" ? "status-ok" : "status-no"}`}><i />{row.status}</span></td>
        <td>{row.rejection_reason ? <span className="rejection-detail">{row.rejection_scope}: {row.rejection_reason.replaceAll("_", " ").toLowerCase()}</span> : <span className="muted">—</span>}</td>
        <td className="date-column">{new Date(row.created_at).toLocaleString()}</td>
      </tr>)}</tbody>
    </table></div>
  );
}

function HistoryPage({ api }: { api: ApiClient }) {
  const [history, setHistory] = useState<History | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"" | "accepted" | "rejected">("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    try {
      const result = await api.listUsers();
      setUsers(result.users);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.getHistory({
        page,
        limit: 20,
        status: status || undefined,
        userId: userId || undefined,
      });
      setHistory(result);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [api, page, status, userId]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">AUDIT TRAIL</span><h1>Usage history</h1><p>Review every accepted and rejected request for this account.</p></div></div>
      <section className="panel history-panel">
        <div className="panel-heading history-heading">
          <div><h2>All requests</h2><p>{history ? `${formattedUnits(history.pagination.total)} total requests` : "Request records for your account"}</p></div>
          <div className="filter-row">
            <select aria-label="Filter by status" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value as "" | "accepted" | "rejected"); }}><option value="">All statuses</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select>
            <select aria-label="Filter by user" value={userId} onChange={(event) => { setPage(1); setUserId(event.target.value); }}><option value="">All users</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
          </div>
        </div>
        {error && <div className="inline-error" role="alert">{error}<button onClick={() => void load()}>Retry</button></div>}
        {loading ? <Loading /> : !history || history.data.length === 0 ? (
          <EmptyState title="No matching requests" detail="Try another filter, or record a usage request to see it here." />
        ) : <>
          <HistoryTable rows={history.data} />
          <div className="pagination">
            <span>Page {history.pagination.page} of {Math.max(1, history.pagination.totalPages)} · {formattedUnits(history.pagination.total)} requests</span>
            <div className="button-row"><button className="button button-light button-small" disabled={!history.pagination.hasPreviousPage} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Previous</button><button className="button button-light button-small" disabled={!history.pagination.hasNextPage} onClick={() => setPage((value) => value + 1)}>Next →</button></div>
          </div>
        </>}
      </section>
    </>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("Overview");
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((nextNotice: Notice) => {
    setNotice(nextNotice);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4500);
  }, []);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const disconnect = useCallback((message: string, kind: Notice["kind"] = "success") => {
    setApiKey(null);
    setActiveSection("Overview");
    notify({ kind, text: message });
  }, [notify]);

  const api = useMemo(
    () => new ApiClient(apiKey ?? "", () => {
      disconnect("Your API key is no longer valid. Reconnect with a valid key to continue.", "error");
    }),
    [apiKey, disconnect],
  );

  if (!apiKey) {
    return <>{notice && <div className={`toast toast-${notice.kind}`} role="status">{notice.text}</div>}<AuthScreen onConnect={setApiKey} notify={notify} /></>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-symbol"><i /><i /><i /></span>
          <span>meterwise</span>
          <span className="brand-edition">METERING</span>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {sections.map((section, index) => <button key={section} className={`nav-item ${activeSection === section ? "nav-active" : ""}`} onClick={() => setActiveSection(section)}>
            <span className="nav-index">0{index + 1}</span><span>{section}</span>{activeSection === section && <i />}
          </button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note"><span className="security-dot" /><span>API key held in memory<br /><small>Cleared when you disconnect</small></span></div>
          <button className="disconnect-button" onClick={() => disconnect("Disconnected. Your API key and account data were cleared from this session.")}>Disconnect account <span>↗</span></button>
          <span className="sidebar-version">USAGE METERING SERVICE</span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><i>/</i><strong>{activeSection}</strong></div>
          <div className="topbar-right"><span className="live-indicator"><i /> API connected</span><span className="topbar-divider" /><span className="today-label">{todayLabel()}</span><button className="mobile-disconnect" onClick={() => disconnect("Disconnected. Your API key and account data were cleared from this session.")} aria-label="Disconnect account">Exit</button></div>
        </header>
        <main className="content-area">
          {activeSection === "Overview" && <DashboardPage api={api} onNavigate={setActiveSection} />}
          {activeSection === "Users" && <UsersPage api={api} notify={notify} />}
          {activeSection === "Plans" && <PlansPage api={api} notify={notify} />}
          {activeSection === "Consume usage" && <ConsumePage api={api} notify={notify} />}
          {activeSection === "History" && <HistoryPage api={api} />}
          <footer className="page-footer"><span>Meterwise Usage Metering</span><span>Securely scoped to your account</span></footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">{sections.map((section, index) => <button key={section} className={activeSection === section ? "mobile-nav-active" : ""} onClick={() => setActiveSection(section)}><span>0{index + 1}</span>{section === "Consume usage" ? "Consume" : section === "Overview" ? "Home" : section}</button>)}</nav>
      {notice && <div className={`toast toast-${notice.kind}`} role="status"><span>{notice.kind === "success" ? "✓" : "!"}</span>{notice.text}<button aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}
    </div>
  );
}
