import { createHash } from "node:crypto";

const NAMESPACE = "6f1c2a7e-3b7d-4c55-9a0e-2f8f3c1d9b42"; // CareFlow seed namespace

/** RFC 4122 v5 UUID: deterministic IDs so demo resets reproduce the exact seed state. */
export function seedUuid(name: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name)])).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
