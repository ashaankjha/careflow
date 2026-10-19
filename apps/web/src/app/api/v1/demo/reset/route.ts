import { resetDemo } from "@careflow/db";
import { route } from "@/lib/server/api";
import { db, maintenanceDb } from "@/lib/server/db";

export const POST = route("demo:reset", async ({ ctx }) => resetDemo(db(), ctx, maintenanceDb()));
