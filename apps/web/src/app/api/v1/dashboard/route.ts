import { getDashboard } from "@careflow/db";
import { route, searchParams } from "@/lib/server/api";
import { db } from "@/lib/server/db";
import { parseDashboardFilters } from "@/lib/filters";

export const GET = route("dashboard:read", async ({ ctx, req }) => getDashboard(db(), ctx, parseDashboardFilters(Object.fromEntries(searchParams(req)))));
