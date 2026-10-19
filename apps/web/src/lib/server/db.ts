import "server-only";
import { getDb } from "@careflow/db";

export const db = () => getDb();
