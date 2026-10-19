import { evaluateParsed, getInquiryRow, inquiryToMatchRequest, listInquiryMatchSnapshots, persistInquiryMatches } from "@careflow/db";
import { route } from "@/lib/server/api";
import { db } from "@/lib/server/db";

/** Live (non-persistent) evaluation plus prior snapshots. */
export const GET = route("matching:evaluate", async ({ ctx, params }) => {
  const inq = await getInquiryRow(db(), ctx, params.id!);
  const [result, snapshots] = await Promise.all([evaluateParsed(db(), ctx, inquiryToMatchRequest(inq)), listInquiryMatchSnapshots(db(), ctx, inq.id)]);
  return { result, snapshots };
});

/** Persist a matching snapshot with explanations. */
export const POST = route("matching:persist", async ({ ctx, params }) => persistInquiryMatches(db(), ctx, params.id!));
