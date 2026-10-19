import { refreshMarket } from "@careflow/db";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

export const POST = route("market:refresh", async ({ ctx }) => refreshMarket(db(), ctx));
