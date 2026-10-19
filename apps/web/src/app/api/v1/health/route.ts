import { pingDb } from "@careflow/db";

/** Non-sensitive liveness/readiness only. */
export async function GET() {
  const ok = await pingDb();
  return Response.json({ status: ok ? "ok" : "degraded", database: ok ? "ok" : "unavailable", mode: "synthetic_demo", time: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
