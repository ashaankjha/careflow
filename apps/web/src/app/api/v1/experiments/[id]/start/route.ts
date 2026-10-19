import { startExperiment } from "@careflow/db";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route("experiment:manage", async ({ ctx, params }) => startExperiment(db(), ctx, params.id!));
