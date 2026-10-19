import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken } from "../src/auth";
import { centerId, HARBOR, LAKESIDE, seedUuid } from "../src/index";
import { AppError } from "../src/services/context";
import { audit } from "../src/services/audit";
import { resetDemo } from "../src/services/demo";
import { getDashboard } from "../src/services/metrics";
import { listMissions } from "../src/services/missions";
import { getInquiryDetail, transitionInquiry } from "../src/services/inquiries";
import { login, logout, resolveSession } from "../src/services/session";
import { withOrg } from "../src/tenant";
import type { Db } from "../src/client";
import { ANCHOR, harbor, lakeside, pgError, reseed, testAppDb, testDb } from "./helpers";

/**
 * Tenant isolation proven under the least-privilege `careflow_app` role the web
 * app uses (migration 0002). The owner connection is used only to seed and to
 * inspect results.
 */
const owner = testDb();
const app = testAppDb();
// A single-connection pool guarantees we observe the same backend before/after a scoped transaction.
const single = testAppDb(1);
beforeAll(() => reseed(owner.db));
afterAll(async () => {
  await Promise.all([owner.client.end(), app.client.end(), single.client.end()]);
});

type Row = Record<string, unknown>;
const q = async (db: { execute: Db["execute"] }, query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as Row[];
const harborInquiry = seedUuid("inquiry:harbor:north:0");

describe("app role", () => {
  it("is not superuser, cannot bypass RLS and owns no tables", async () => {
    const [r] = await q(app.db, sql`select current_user as u, rolsuper, rolbypassrls from pg_roles where rolname = current_user`);
    expect(r).toEqual({ u: "careflow_app", rolsuper: false, rolbypassrls: false });
    const [o] = await q(app.db, sql`select count(*)::int n from pg_tables where schemaname = 'public' and tableowner = current_user`);
    expect(o!.n).toBe(0);
  });

  it("every table with organization_id (and organizations) has RLS enabled + FORCED and a policy", async () => {
    const rows = await q(
      owner.db,
      sql`select c.relname, c.relrowsecurity, c.relforcerowsecurity, (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and (c.relname = 'organizations' or exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'organization_id'))`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(26);
    for (const r of rows) expect({ t: r.relname, rls: r.relrowsecurity, force: r.relforcerowsecurity, has: (r.policies as number) > 0 }).toEqual({ t: r.relname, rls: true, force: true, has: true });
  });
});

describe("missing app.current_org fails closed", () => {
  it("reads return nothing on every tenant table", async () => {
    for (const t of ["organizations", "users", "sessions", "centers", "payers", "inquiries", "inquiry_events", "missions", "audit_logs", "daily_metrics", "geo_signals"]) {
      const [r] = await q(app.db, sql`select count(*)::int n from ${sql.identifier(t)}`);
      expect({ t, n: r!.n }).toEqual({ t, n: 0 });
    }
  });

  it("writes are rejected", async () => {
    expect(await pgError(app.db.execute(sql`insert into payers (organization_id, name, category) values (${HARBOR.id}, 'X', 'commercial')`))).toMatch(/row-level security/);
    const upd = await q(app.db, sql`update centers set name = 'pwned' returning id`);
    expect(upd).toEqual([]);
  });

  it("an empty tenant string behaves the same as unset", async () => {
    const n = await app.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', '', true)`);
      return (await q(tx, sql`select count(*)::int n from inquiries`))[0]!.n;
    });
    expect(n).toBe(0);
  });
});

describe("cross-tenant access under the app role", () => {
  it("reads only ever see the current tenant, even with guessed ids and no WHERE organization_id", async () => {
    await withOrg(app.db, LAKESIDE.id, async (tx) => {
      expect(await q(tx, sql`select id from inquiries where id = ${harborInquiry}`)).toEqual([]);
      const orgs = await q(tx, sql`select distinct organization_id from inquiries`);
      expect(orgs.map((r) => r.organization_id)).toEqual([LAKESIDE.id]);
      expect((await q(tx, sql`select id from organizations`)).map((r) => r.id)).toEqual([LAKESIDE.id]);
      expect((await q(tx, sql`select distinct organization_id from users`)).map((r) => r.organization_id)).toEqual([LAKESIDE.id]);
    });
  });

  it("writes into another tenant fail or touch zero rows", async () => {
    // INSERT with a foreign organization_id violates WITH CHECK
    expect(await pgError(withOrg(app.db, LAKESIDE.id, (tx) => tx.execute(sql`insert into payers (organization_id, name, category) values (${HARBOR.id}, 'Injected', 'commercial')`)))).toMatch(/row-level security/);
    // UPDATE/DELETE of another tenant's rows match nothing
    const touched = await withOrg(app.db, LAKESIDE.id, async (tx) => ({
      upd: (await q(tx, sql`update centers set name = 'pwned' where id = ${centerId("west")} returning id`)).length,
      del: (await q(tx, sql`delete from capacity_rules where center_id = ${centerId("west")} returning id`)).length,
    }));
    expect(touched).toEqual({ upd: 0, del: 0 });
    // moving an own row into another tenant violates WITH CHECK
    expect(await pgError(withOrg(app.db, LAKESIDE.id, (tx) => tx.execute(sql`update payers set organization_id = ${HARBOR.id}`)))).toMatch(/row-level security/);
    const [west] = await q(owner.db, sql`select name from centers where id = ${centerId("west")}`);
    expect(west!.name).not.toBe("pwned");
  });

  it("services running on a tenant transaction cannot reach the other tenant", async () => {
    await expect(withOrg(app.db, LAKESIDE.id, (tx) => getInquiryDetail(tx as unknown as Db, lakeside(), harborInquiry))).rejects.toMatchObject({ code: "NOT_FOUND" });
    // even a ctx that names Harbor sees nothing when the transaction is scoped to Lakeside (defense in depth)
    const leaked = await withOrg(app.db, LAKESIDE.id, (tx) => listMissions(tx, harbor()));
    expect(leaked).toEqual([]);
  });

  it("the tenant setting is transaction-local and never leaks to the next use of the connection", async () => {
    expect(await withOrg(single.db, HARBOR.id, async (tx) => (await q(tx, sql`select count(*)::int n from inquiries`))[0]!.n)).toBeGreaterThan(0);
    const [after] = await q(single.db, sql`select coalesce(current_setting('app.current_org', true), '') org, (select count(*)::int from inquiries) n`);
    expect(after).toEqual({ org: "", n: 0 });
  });

  it("rejects a malformed tenant id before touching the database", async () => {
    await expect(withOrg(app.db, "' or 1=1 --", async () => 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("services work end-to-end under the app role", () => {
  it("dashboard, missions and inquiry transitions", async () => {
    const d = await withOrg(app.db, LAKESIDE.id, (tx) => getDashboard(tx, lakeside(), { from: new Date(ANCHOR.getTime() - 90 * 86_400_000), to: ANCHOR }));
    expect(d.kpis.inquiries_created.value).toBe(5);
    expect((await withOrg(app.db, HARBOR.id, (tx) => listMissions(tx, harbor()))).length).toBeGreaterThan(0);
    const [open] = await q(owner.db, sql`select id from inquiries where organization_id = ${HARBOR.id} and stage = 'new' order by id limit 1`);
    const r = await withOrg(app.db, HARBOR.id, (tx) => transitionInquiry(tx as unknown as Db, harbor("intake"), open!.id as string, { toStage: "withdrawn", reason: "family_declined", eventIdempotencyKey: "app-role-1" }).catch((e) => e));
    expect(r).toMatchObject({ replayed: false, inquiry: { stage: "withdrawn" } });
    const [ev] = await q(owner.db, sql`select organization_id from inquiry_events where idempotency_key = ${"transition:app-role-1"}`);
    expect(ev!.organization_id).toBe(HARBOR.id);
  });

  it("AppError commits prior writes (denial audits survive); other errors roll back", async () => {
    const count = async (action: string) => (await q(owner.db, sql`select count(*)::int n from audit_logs where action = ${action}`))[0]!.n;
    await expect(
      withOrg(app.db, HARBOR.id, async (tx) => {
        await audit(tx, harbor(), "test.denied_kept", "test", null, false);
        throw new AppError("FORBIDDEN", "nope");
      }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      withOrg(app.db, HARBOR.id, async (tx) => {
        await audit(tx, harbor(), "test.rolled_back", "test", null, true);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await count("test.denied_kept")).toBe(1);
    expect(await count("test.rolled_back")).toBe(0);
  });

  it("immutable logs cannot be purged by the app role, even with the purge GUC set", async () => {
    const msg = await pgError(
      withOrg(app.db, HARBOR.id, async (tx) => {
        await tx.execute(sql`set local careflow.allow_purge = 'on'`);
        await tx.execute(sql`delete from audit_logs`);
      }),
    );
    expect(msg).toMatch(/permission denied/);
    expect(await pgError(withOrg(app.db, HARBOR.id, (tx) => tx.execute(sql`update inquiry_events set metadata = '{}'`)))).toMatch(/permission denied/);
    expect(await pgError(app.db.execute(sql`truncate rate_limit_buckets`))).toMatch(/permission denied/);
  });
});

describe("pre-tenant session functions (SECURITY DEFINER)", () => {
  it("sign-in, cookie resolution and logout work without a tenant, exposing only the matching row", async () => {
    const res = await login(app.db, "Admin@Harbor.demo ", "demo-pass-2026");
    expect(res?.user.organizationId).toBe(HARBOR.id);
    expect(await login(app.db, "admin@harbor.demo", "wrong")).toBeNull();
    expect(await login(app.db, "nobody@harbor.demo", "demo-pass-2026")).toBeNull();
    const s = await resolveSession(app.db, res!.token);
    expect(s?.ctx).toMatchObject({ orgId: HARBOR.id, role: "admin" });
    expect(s?.org.name).toBeTruthy();
    expect(await resolveSession(app.db, "bogus-token")).toBeNull();
    // the session row itself is still invisible without a tenant
    expect(await q(app.db, sql`select id from sessions where token_hash = ${hashToken(res!.token)}`)).toEqual([]);
    await logout(app.db, res!.token);
    expect(await resolveSession(app.db, res!.token)).toBeNull();
  });

  it("expired sessions do not resolve", async () => {
    const res = await login(app.db, "admin@lakeside.demo", "demo-pass-2026");
    await owner.db.execute(sql`update sessions set expires_at = now() - interval '1 minute' where token_hash = ${hashToken(res!.token)}`);
    expect(await resolveSession(app.db, res!.token)).toBeNull();
  });

  it("the app role cannot call the definer functions' internals or other privileged functions", async () => {
    expect(await pgError(app.db.execute(sql`select careflow_forbid_mutation()`))).toMatch(/trigger|permission/);
  });
});

describe("demo reset purge path", () => {
  it("is FEATURE_DISABLED without a maintenance connection and audited", async () => {
    await expect(withOrg(app.db, HARBOR.id, (tx) => resetDemo(tx, harbor(), null))).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
    const [r] = await q(owner.db, sql`select count(*)::int n from audit_logs where action = 'demo.reset' and allowed = false`);
    expect(r!.n).toBeGreaterThan(0);
  });

  it("refuses a maintenance connection that cannot bypass RLS", async () => {
    await expect(withOrg(app.db, HARBOR.id, (tx) => resetDemo(tx, harbor(), app.db))).rejects.toThrow(/SUPERUSER or BYPASSRLS/);
  });

  it("restores the seed via the owner connection while checks and audit run on the tenant transaction", async () => {
    const result = await withOrg(app.db, HARBOR.id, (tx) => resetDemo(tx, { ...harbor(), now: undefined }, owner.db));
    expect(result.inquiries).toBeGreaterThan(0);
    const [r] = await q(owner.db, sql`select count(*)::int n from audit_logs where action = 'demo.reset' and allowed = true`);
    expect(r!.n).toBe(1);
    await reseed(owner.db);
  });
});

describe("default privileges for tables added by later migrations", () => {
  it("grant the app role DML on new owner-created tables", async () => {
    const granted = await owner.db
      .transaction(async (tx) => {
        await tx.execute(sql`create table zz_future_tenant_table (id int)`);
        const [r] = await q(tx, sql`select has_table_privilege('careflow_app', 'zz_future_tenant_table', 'select,insert,update,delete') ok, has_table_privilege('careflow_app', 'zz_future_tenant_table', 'truncate') tr`);
        throw Object.assign(new Error("rollback"), { r });
      })
      .catch((e: { r?: Row }) => e.r);
    expect(granted).toEqual({ ok: true, tr: false });
  });
});
