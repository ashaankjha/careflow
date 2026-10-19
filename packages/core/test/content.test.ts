import { describe, expect, it } from "vitest";
import { ES_MACHINE_AUTHORED_NOTE, renderDraft, validateDraft, type VerifiedFacts } from "../src/content";
import { markdownToHtml } from "../src/markdown";
import { DRAFT_KINDS } from "../src/missions";

const facts: VerifiedFacts = {
  orgName: "Harbor Behavioral Services (DEMO)",
  center: { name: "West Center", addressLine: "200 Demo Way", city: "Harbor Bay (DEMO)", state: "DM", zip: "00105", serviceModes: ["center", "telehealth_if_applicable"], serviceRadiusMiles: 11, acceptedAgeMin: 2, acceptedAgeMax: 16, intakePhone: "555-0101 (demo)", intakeEmail: "west@harbor.demo" },
  verifiedPayers: [{ name: "Cascade Commercial (DEMO)", lastVerifiedAt: "2026-10-01T00:00:00Z" }, { name: "Meridian Medicaid Plan (DEMO)", lastVerifiedAt: "2026-10-01T00:00:00Z" }],
  otherPayers: ["Pinecrest Health Network (DEMO)"],
  verifiedHoursAvailable: 46,
  capacityVerifiedAt: "2026-10-15T00:00:00Z",
  serviceAreaZctas: ["00101", "00105", "00106"],
  referralCode: "BAYPEDS",
  partnerName: "Bayview Pediatrics Group (DEMO)",
  mission: null,
};

const withMission: VerifiedFacts = {
  ...facts,
  referralCode: null,
  partnerName: null,
  verifiedPayers: [],
  mission: {
    title: "Fill verified West capacity",
    explanation: "West has verified unbooked hours.",
    proposedAction: "Share the factual referral packet with partners.",
    guardrail: "Pause if verified capacity drops.",
    evidence: [
      { metricKey: "verified_weekly_direct_hours_available", label: "Verified direct h/wk available", numerator: 46, denominator: null, timeRange: "as of 2026-10-15", eventCount: 0 },
      { metricKey: "inquiries", label: "Inquiries vs peer median", numerator: 8, denominator: 20, timeRange: "last 30 days", eventCount: 8 },
    ],
    experiment: { hypothesis: "A factual packet increases verified starts.", primaryMetric: "care_starts", guardrails: ["median_first_response", "close_without_resolution"] },
  },
};

describe("en-US output is unchanged", () => {
  for (const k of DRAFT_KINDS) {
    it(`${k} matches the pre-locale snapshot`, () => {
      expect(renderDraft(k, facts)).toMatchSnapshot();
      expect(renderDraft(k, withMission)).toMatchSnapshot();
    });
  }
});

describe("deterministic drafts (AI disabled)", () => {
  it("referral packet is substantive and only lists verified facts", () => {
    const d = renderDraft("partner_packet", facts);
    expect(d.bodyMd.length).toBeGreaterThan(800);
    expect(d.bodyMd).toContain("Meridian Medicaid Plan (DEMO)");
    expect(d.bodyMd).toContain("subject to verification");
    expect(d.bodyMd).not.toContain("Pinecrest");
    expect(d.bodyMd).toMatch(/do not offer gifts, payments/i);
    expect(validateDraft(d.bodyMd, facts, "partner_packet").status).toBe("pass");
  });
  it("every template passes the claim validator", () => {
    for (const k of ["seo_page", "partner_packet", "referral_email", "internal_plan"] as const) {
      expect(validateDraft(renderDraft(k, facts).bodyMd, facts, k).issues).toEqual([]);
    }
  });
});

describe("es-US templates (machine-authored, need translator review)", () => {
  it("every template renders in Spanish, keeps facts and caveats, and passes the validator", () => {
    for (const k of DRAFT_KINDS) {
      for (const f of [facts, withMission]) {
        const d = renderDraft(k, f, "es-US");
        expect(d.bodyMd.startsWith(ES_MACHINE_AUTHORED_NOTE)).toBe(true);
        expect(d.bodyMd).not.toEqual(renderDraft(k, f).bodyMd);
        expect(validateDraft(d.bodyMd, f, k).issues).toEqual([]);
      }
    }
  });
  it("referral packet carries the same verified facts and mandatory disclaimers", () => {
    const d = renderDraft("partner_packet", facts, "es-US");
    expect(d.title).toBe("Información de referidos para profesionales — West Center");
    expect(d.bodyMd.length).toBeGreaterThan(800);
    expect(d.bodyMd).toContain("Meridian Medicaid Plan (DEMO) — participación verificada por el personal el 2026-10-01");
    expect(d.bodyMd).toContain("Cascade Commercial (DEMO)");
    expect(d.bodyMd).not.toContain("Pinecrest");
    expect(d.bodyMd).toContain("**sujeta a verificación**");
    expect(d.bodyMd).toContain("código de referencia **BAYPEDS**");
    expect(d.bodyMd).toContain("00101, 00105, 00106");
    expect(d.bodyMd).toContain("555-0101 (demo)");
    expect(d.bodyMd).toMatch(/No ofrecemos regalos, pagos ni nada de valor/);
    expect(d.bodyMd).toMatch(/Demostración sintética.*no es una cita ni una verificación de beneficios.*no hace afirmaciones clínicas/);
    expect(d.bodyMd).toMatch(/No damos tiempos de espera ni prometemos fechas de inicio/);
  });
  it("referral email and internal plan keep the draft notice and evidence placeholders", () => {
    expect(renderDraft("referral_email", facts, "es-US").bodyMd).toContain("El envío está desactivado en esta demostración");
    const plan = renderDraft("internal_plan", withMission, "es-US").bodyMd;
    expect(plan).toContain("- **Verified direct h/wk available**: 46 (as of 2026-10-15; métrica `verified_weekly_direct_hours_available`)");
    expect(plan).toContain("- **Inquiries vs peer median**: 8 / 20");
    expect(plan).toContain("(46 h directas/sem al 2026-10-15)");
    expect(plan).toContain("`median_first_response`, `close_without_resolution`");
  });
  it("no verified payers: Spanish packet says so and never claims staff verification", () => {
    const d = renderDraft("partner_packet", withMission, "es-US");
    expect(d.bodyMd).toContain("Actualmente no hay participación de planes de seguro verificada");
    expect(validateDraft(`${d.bodyMd}\nMeridian — participación verificada por el personal`, withMission, "partner_packet").issues.map((i) => i.message)).toContain("Payer verification claimed but none on record");
  });
  it("the machine-authored note is hidden in the HTML preview", () => {
    expect(markdownToHtml(renderDraft("partner_packet", facts, "es-US").bodyMd)).not.toContain("machine-authored");
  });
});

describe("claim validator", () => {
  it("flags unverified payers, guarantees, wait-time promises and remuneration", () => {
    const bad = "We accept Pinecrest Health Network (DEMO). Guaranteed results, no waitlist, start within 3 days. $50 gift card per referral.";
    const v = validateDraft(bad, facts, "partner_packet");
    expect(v.status).toBe("needs_review");
    const msgs = v.issues.map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/not verified as accepted/);
    expect(msgs).toMatch(/guarantees/);
    expect(msgs).toMatch(/Wait-time/);
    expect(msgs).toMatch(/Timeframe/);
    expect(msgs).toMatch(/remuneration/);
  });
  it("flags ZIPs outside the verified service area", () => {
    expect(validateDraft("We serve 90210.", facts, "seo_page").issues[0]?.message).toMatch(/not in the verified service area/);
  });
  it("flags HIPAA compliance claims in English", () => {
    for (const t of ["We are HIPAA compliant.", "Our portal is HIPAA-certified.", "Fully compliant with HIPAA."]) {
      expect(validateDraft(t, facts, "seo_page").issues.map((i) => i.message), t).toContain("Compliance claims (e.g. HIPAA) are not allowed");
    }
  });

  const es: [string, RegExp][] = [
    ["Resultados garantizados para su hijo.", /guarantees/],
    ["Le damos una garantía de acceso.", /guarantees/],
    ["Nuestro programa cura el autismo.", /Cure claims/],
    ["Sin lista de espera.", /Wait-time/],
    ["Atendemos sin espera.", /Wait-time/],
    ["Cupos inmediatos para nuevas familias.", /Availability/],
    ["Su hijo puede empezar esta semana.", /Availability/],
    ["Reciba una tarjeta de regalo de $50.", /remuneration/],
    ["Pagamos una comisión por cada referido.", /remuneration/],
    ["Ofrecemos incentivos a los socios.", /remuneration/],
    ["Somos el mejor centro de la ciudad, con testimonios de cinco estrellas.", /Testimonials/],
    ["Hacemos el diagnóstico en la primera visita.", /clinical/],
    ["Tratamiento del autismo con recuperación completa.", /clinical/],
    ["Nuestra clínica cumple con HIPAA.", /Compliance claims/],
    ["Plataforma en cumplimiento con la ley HIPAA.", /Compliance claims/],
    ["Iniciamos los servicios en 3 días hábiles.", /Timeframe/],
    ["Le llamamos dentro de 2 semanas.", /Timeframe/],
    ["Tenemos 12 horas disponibles esta semana.", /Capacity claims/],
    ["Aceptamos Pinecrest Health Network (DEMO).", /not verified as accepted/],
  ];
  for (const [text, msg] of es) {
    it(`flags Spanish prohibited claim: ${text}`, () => {
      const v = validateDraft(text, facts, "partner_packet");
      expect(v.status).toBe("needs_review");
      expect(v.issues.map((i) => i.message).join(" | ")).toMatch(msg);
    });
  }
  it("Spanish word boundaries avoid false positives", () => {
    for (const t of ["Procuramos responder con cuidado.", "Un método seguro y una atención segura.", "Estamos a su disposición.", "Incluya su número de teléfono.", "Ofrecemos curaduría de recursos."]) {
      expect(validateDraft(t, facts, "partner_packet").issues, t).toEqual([]);
    }
  });
});
