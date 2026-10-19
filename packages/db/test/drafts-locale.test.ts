import { createLlmProvider } from "@careflow/connectors";
import { ES_MACHINE_AUTHORED_NOTE, type ValidationResult } from "@careflow/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { approveDraft, exportDraft, generateDraft, listDrafts, updateDraft } from "../src/services/drafts";
import { centerId, partnerId } from "../src/seed/fixtures";
import { harbor, reseed, testDb } from "./helpers";

const { db, client } = testDb();
beforeAll(() => reseed(db));
afterAll(() => client.end());

const WEST = centerId("west");

function mockLlm(content: string) {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));
  return { fetchImpl, provider: createLlmProvider({ baseUrl: "http://llm.invalid", apiKey: "k", model: "m", fetchImpl: fetchImpl as unknown as typeof fetch }) };
}

describe("es-US drafts", () => {
  it("defaults to en-US", async () => {
    const d = await generateDraft(db, harbor("growth"), { centerId: WEST, kind: "partner_packet" });
    expect(d.locale).toBe("en-US");
    expect(d.title).toBe("Professional referral information — West Center");
  });

  it("generates, validates, approves and exports a Spanish referral packet from verified records", async () => {
    const d = await generateDraft(db, harbor("growth"), { centerId: WEST, partnerId: partnerId("bayview"), kind: "partner_packet", locale: "es-US" });
    expect(d.locale).toBe("es-US");
    expect(d.generator).toBe("template");
    expect(d.title).toBe("Información de referidos para profesionales — West Center");
    expect(d.bodyMd.startsWith(ES_MACHINE_AUTHORED_NOTE)).toBe(true);
    expect(d.bodyMd).toContain("Meridian Medicaid Plan (DEMO) — participación verificada por el personal");
    expect(d.bodyMd).not.toContain("Pinecrest");
    expect(d.bodyMd).toContain("código de referencia **BAYPEDS**");
    expect(d.approvalStatus).toBe("draft");
    expect(d.validation).toMatchObject({ status: "pass", issues: [] });

    // Spanish prohibited claims added by an editor block approval
    const edited = await updateDraft(db, harbor("growth"), d.id, { bodyMd: `${d.bodyMd}\nResultados garantizados y una tarjeta de regalo por cada referido. Cumple con HIPAA.`, revision: 1 });
    expect(edited.approvalStatus).toBe("needs_review");
    expect((edited.validation as ValidationResult).issues.map((i) => i.message)).toEqual(
      expect.arrayContaining(["Outcome or access guarantees are not allowed", "Referral remuneration language is not allowed", "Compliance claims (e.g. HIPAA) are not allowed"]),
    );
    await expect(approveDraft(db, harbor("growth"), d.id)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await updateDraft(db, harbor("growth"), d.id, { bodyMd: d.bodyMd, revision: 2 });
    const approved = await approveDraft(db, harbor("growth"), d.id);
    expect(approved.approvalStatus).toBe("approved");
    expect(approved.locale).toBe("es-US");

    const html = await exportDraft(db, harbor("growth"), d.id, "html");
    expect(html.content).toContain("<h1>Información de referidos para socios profesionales</h1>");
    expect(html.content).not.toContain("machine-authored");
    expect((await exportDraft(db, harbor("growth"), d.id, "md")).content).toContain("machine-authored");
    expect((await listDrafts(db, harbor())).find((x) => x.id === d.id)?.locale).toBe("es-US");
  });

  it("rejects unsupported locales", async () => {
    await expect(generateDraft(db, harbor("growth"), { centerId: WEST, kind: "partner_packet", locale: "fr-FR" as "es-US" })).rejects.toThrow();
  });

  it("LLM path receives the locale and falls back to the Spanish template when output fails validation", async () => {
    const bad = mockLlm("Atención garantizada, sin lista de espera y una tarjeta de regalo de $50 por cada referido.");
    const d = await generateDraft(db, harbor("growth"), { centerId: WEST, kind: "seo_page", locale: "es-US" }, bad.provider);
    const sent = JSON.parse(JSON.parse((bad.fetchImpl.mock.calls[0]![1] as RequestInit).body as string).messages[1].content);
    expect(sent.locale).toBe("es-US");
    expect(sent.baseDraft).toContain("servicios de análisis aplicado de la conducta");
    expect(d.generator).toBe("template");
    expect(d.locale).toBe("es-US");
    expect(d.title).toBe("West Center — servicios de terapia ABA en Harbor Bay (DEMO)");
    expect(d.bodyMd).not.toMatch(/garantizad/);
    expect(d.validation).toMatchObject({ status: "pass" });

    const ok = mockLlm("# West Center\n\nInformación sobre los servicios de ABA en West Center. La participación en los planes está **sujeta a verificación**.");
    const d2 = await generateDraft(db, harbor("growth"), { centerId: WEST, kind: "seo_page", locale: "es-US" }, ok.provider);
    expect(d2.generator).toBe("llm");
    expect(d2.locale).toBe("es-US");
  });
});
