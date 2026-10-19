import { CSV_TEMPLATE } from "@careflow/core";
import { route } from "@/lib/server/api";

export const GET = route("inquiry:read", async () => new Response(CSV_TEMPLATE, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=careflow-demo-inquiries-template.csv" } }));
