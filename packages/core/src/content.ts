/**
 * Deterministic, approval-only content drafting (PRD §12). Drafts are built
 * strictly from verified records; a claim validator flags anything that
 * cannot be traced to those records. Nothing here sends or publishes.
 */
import type { DraftKind, EvidenceItem } from "./missions";
import { SERVICE_MODE_LABELS, type DraftLocale, type ServiceMode } from "./schemas";

export type VerifiedFacts = {
  orgName: string;
  center: {
    name: string;
    addressLine: string;
    city: string;
    state: string;
    zip: string;
    serviceModes: ServiceMode[];
    serviceRadiusMiles: number;
    acceptedAgeMin: number | null;
    acceptedAgeMax: number | null;
    intakePhone: string;
    intakeEmail: string;
  };
  verifiedPayers: { name: string; lastVerifiedAt: string }[];
  /** Payers whose participation is unknown or not accepted at this site — must never be listed as accepted. */
  otherPayers: string[];
  verifiedHoursAvailable: number | null;
  capacityVerifiedAt: string | null;
  serviceAreaZctas: string[];
  referralCode?: string | null;
  partnerName?: string | null;
  mission?: {
    title: string;
    explanation: string;
    proposedAction: string;
    guardrail: string;
    evidence: EvidenceItem[];
    experiment?: { hypothesis: string; primaryMetric: string; guardrails: string[] } | null;
  } | null;
};

const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "not verified");
const modes = (f: VerifiedFacts) => f.center.serviceModes.map((m) => SERVICE_MODE_LABELS[m]).join(", ");
const ages = (f: VerifiedFacts) =>
  f.center.acceptedAgeMin != null || f.center.acceptedAgeMax != null
    ? `Practice policy: ages ${f.center.acceptedAgeMin ?? "—"}–${f.center.acceptedAgeMax ?? "—"} (confirm with intake).`
    : "";
const payerList = (f: VerifiedFacts) =>
  f.verifiedPayers.length
    ? f.verifiedPayers.map((p) => `- ${p.name} — participation verified by staff on ${dateOnly(p.lastVerifiedAt)}`).join("\n")
    : "- No payer participation is currently verified for this location. Please contact intake.";

const PAYER_CAVEAT =
  "Plan participation is listed as recorded by our staff and is **subject to verification**. It does not confirm any individual family's coverage, benefits, or authorization.";

export type RenderedDraft = { title: string; bodyMd: string };

/** Render a deterministic draft. `es-US` templates are machine-authored and need review by a qualified human translator. */
export function renderDraft(kind: DraftKind, f: VerifiedFacts, locale: DraftLocale = "en-US"): RenderedDraft {
  return locale === "es-US" ? renderDraftEs(kind, f) : renderDraftEn(kind, f);
}

function renderDraftEn(kind: DraftKind, f: VerifiedFacts): RenderedDraft {
  const c = f.center;
  switch (kind) {
    case "seo_page":
      return {
        title: `${c.name} — ABA therapy services in ${c.city}`,
        bodyMd: `# ${c.name}

${f.orgName} provides applied behavior analysis (ABA) services at ${c.name}, ${c.addressLine}, ${c.city}, ${c.state} ${c.zip}.

## Services offered at this location
- Service modes: ${modes(f)}
- Operational service area: approximately ${c.serviceRadiusMiles} miles from the center
${ages(f) ? `- ${ages(f)}\n` : ""}
## Insurance plans
${payerList(f)}

${PAYER_CAVEAT}

## How the inquiry process works
1. Contact our intake team by phone or the clinic's interest form.
2. An intake coordinator follows up to learn about scheduling preferences and insurance.
3. Our staff verify benefits and any required authorization with your plan.
4. If services are a fit, the clinical team coordinates an assessment.

Timeframes vary by plan and staffing; our team will explain next steps directly.

## Frequently asked questions
**Do I need a referral?** Requirements depend on your plan. Our intake team can explain what your plan typically asks for.

**Can I tour the center?** Ask our intake coordinator about visiting options.

**What should I avoid sending by email?** Please do not email medical records or insurance cards. Intake will share a secure method.

## Contact
- Intake phone: ${c.intakePhone}
- Intake email: ${c.intakeEmail}

<!-- schema.org (factual fields only) -->
\`\`\`json
${JSON.stringify(
  {
    "@context": "https://schema.org",
    "@type": "MedicalBusiness",
    name: c.name,
    address: { "@type": "PostalAddress", streetAddress: c.addressLine, addressLocality: c.city, addressRegion: c.state, postalCode: c.zip },
    telephone: c.intakePhone,
  },
  null,
  2,
)}
\`\`\`
`,
      };
    case "partner_packet":
      return {
        title: `Professional referral information — ${c.name}`,
        bodyMd: `# Referral information for professional partners
**${f.orgName} · ${c.name}**
${c.addressLine}, ${c.city}, ${c.state} ${c.zip}

## Service area
We serve families within approximately ${c.serviceRadiusMiles} miles of the center (service-area ZCTAs: ${f.serviceAreaZctas.join(", ") || "on request"}).

## Services at this location
- ${modes(f)}
${ages(f) ? `- ${ages(f)}\n` : ""}
## Insurance plans
${payerList(f)}

${PAYER_CAVEAT}

## How to refer
- Share our intake contact with the family, or have the family contact us directly.
- **Do not send diagnoses, records, or insurance details by regular email or fax cover notes.** Our intake team will provide a secure channel.
${f.referralCode ? `- Optional: families may mention referral code **${f.referralCode}** so we can count referrals in aggregate. We never share an individual family's status with referring partners.\n` : ""}
## What happens next
Our intake team contacts the family, reviews scheduling preferences, and our staff verify benefits and any required authorization. We do not quote wait times or promise start dates in advance.

## Intake contact
- Phone: ${c.intakePhone}
- Email: ${c.intakeEmail}

_We do not offer gifts, payments, or anything of value for referrals._
`,
      };
    case "referral_email":
      return {
        title: `Draft introduction email — ${c.name}`,
        bodyMd: `**Subject:** Referral information for ${c.name}

Hello${f.partnerName ? ` ${f.partnerName} team` : ""},

I'm reaching out from ${f.orgName} to share up-to-date information about ABA services at ${c.name} (${c.city}, ${c.state}). We'd welcome the chance to be a resource for families you work with.

- Services: ${modes(f)}
- Service area: about ${c.serviceRadiusMiles} miles around the center
- Plans with staff-verified participation: ${f.verifiedPayers.map((p) => p.name).join(", ") || "please contact intake"} (subject to verification of each family's benefits)

Our one-page referral sheet is attached for your reference. Please don't include patient details in email; families can contact our intake team directly at ${c.intakePhone}.

Thank you,
[Staff name], ${f.orgName}

_DRAFT — requires human review. Sending is disabled in this demo._
`,
      };
    case "internal_plan": {
      const m = f.mission;
      return {
        title: `Internal growth plan — ${m?.title ?? c.name}`,
        bodyMd: `# Internal plan: ${m?.title ?? c.name}

## Evidence (from saved metrics)
${(m?.evidence ?? []).map((e) => `- **${e.label}**: ${e.numerator}${e.denominator != null ? ` / ${e.denominator}` : ""} (${e.timeRange}; metric \`${e.metricKey}\`)`).join("\n") || "- No evidence attached"}

## Explanation
${m?.explanation ?? ""}

## Proposed action
${m?.proposedAction ?? ""}

## Guardrail
${m?.guardrail ?? ""}

## Measurement
- Hypothesis: ${m?.experiment?.hypothesis ?? "—"}
- Primary metric: \`${m?.experiment?.primaryMetric ?? "—"}\` on the CareFlow dashboard
- Guardrails: ${(m?.experiment?.guardrails ?? []).map((g) => `\`${g}\``).join(", ") || "—"}

## Review checklist
- [ ] Operations confirmed current verified capacity (${f.verifiedHoursAvailable ?? "unverified"} direct h/wk as of ${dateOnly(f.capacityVerifiedAt)})
- [ ] Payer details verified within policy
- [ ] No family-level data used or shared
- [ ] Owner and review date assigned

## Halt conditions
- Verified capacity drops below the mission threshold
- Median first response time worsens beyond SLA
- Close-without-resolution rate increases
`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// es-US templates. Machine-authored, plain neutral US Spanish; the same facts,
// evidence placeholders and caveats as en-US. Must be reviewed by a qualified
// human translator before any real use. Avoid wording the validator rejects
// (e.g. "garantía", "diagnóstico", "sin espera").
// ---------------------------------------------------------------------------

/** Hidden in previews (HTML comment); kept in Markdown exports. */
export const ES_MACHINE_AUTHORED_NOTE =
  "<!-- es-US: machine-authored Spanish template. Requires review by a qualified human translator before any real use. / Plantilla en español redactada automáticamente: requiere revisión por un traductor humano calificado antes de cualquier uso real. -->";

const SERVICE_MODE_LABELS_ES: Record<ServiceMode, string> = {
  center: "En el centro",
  home: "En el hogar",
  telehealth_if_applicable: "Telesalud (si corresponde)",
};
const dateOnlyEs = (iso: string | null) => (iso ? iso.slice(0, 10) : "no verificada");
const modesEs = (f: VerifiedFacts) => f.center.serviceModes.map((m) => SERVICE_MODE_LABELS_ES[m]).join(", ");
const agesEs = (f: VerifiedFacts) =>
  f.center.acceptedAgeMin != null || f.center.acceptedAgeMax != null
    ? `Política de la práctica: edades de ${f.center.acceptedAgeMin ?? "—"} a ${f.center.acceptedAgeMax ?? "—"} años (confirme con el equipo de admisión).`
    : "";
const payerListEs = (f: VerifiedFacts) =>
  f.verifiedPayers.length
    ? f.verifiedPayers.map((p) => `- ${p.name} — participación verificada por el personal el ${dateOnlyEs(p.lastVerifiedAt)}`).join("\n")
    : "- Actualmente no hay participación de planes de seguro verificada para esta ubicación. Comuníquese con el equipo de admisión.";

const PAYER_CAVEAT_ES =
  "La participación en los planes se indica según lo registrado por nuestro personal y está **sujeta a verificación**. No confirma la cobertura, los beneficios ni la autorización de ninguna familia en particular.";
const DEMO_NOTICE_ES =
  "_Demostración sintética con una organización ficticia. Este documento no es una cita ni una verificación de beneficios, y no hace afirmaciones clínicas._";

function renderDraftEs(kind: DraftKind, f: VerifiedFacts): RenderedDraft {
  const c = f.center;
  switch (kind) {
    case "seo_page":
      return {
        title: `${c.name} — servicios de terapia ABA en ${c.city}`,
        bodyMd: `${ES_MACHINE_AUTHORED_NOTE}
# ${c.name}

${f.orgName} ofrece servicios de análisis aplicado de la conducta (ABA, por sus siglas en inglés) en ${c.name}, ${c.addressLine}, ${c.city}, ${c.state} ${c.zip}.

## Servicios en esta ubicación
- Modalidades de servicio: ${modesEs(f)}
- Área de servicio: aproximadamente ${c.serviceRadiusMiles} millas alrededor del centro
${agesEs(f) ? `- ${agesEs(f)}\n` : ""}
## Planes de seguro
${payerListEs(f)}

${PAYER_CAVEAT_ES}

## Cómo funciona el proceso de consulta
1. Comuníquese con nuestro equipo de admisión por teléfono o mediante el formulario de interés de la clínica.
2. Un coordinador de admisión le dará seguimiento para conocer sus preferencias de horario y su seguro.
3. Nuestro personal verifica los beneficios y cualquier autorización requerida con su plan.
4. Si los servicios son adecuados, el equipo clínico coordina una evaluación.

Los plazos varían según el plan y el personal disponible; nuestro equipo le explicará los próximos pasos directamente.

## Preguntas frecuentes
**¿Necesito un referido?** Los requisitos dependen de su plan. Nuestro equipo de admisión puede explicarle lo que su plan suele pedir.

**¿Puedo visitar el centro?** Pregunte a nuestro coordinador de admisión sobre las opciones de visita.

**¿Qué no debo enviar por correo electrónico?** No envíe expedientes médicos ni tarjetas de seguro por correo electrónico. El equipo de admisión le indicará un método seguro.

## Contacto
- Teléfono de admisión: ${c.intakePhone}
- Correo electrónico de admisión: ${c.intakeEmail}

${DEMO_NOTICE_ES}

<!-- schema.org (factual fields only) -->
\`\`\`json
${JSON.stringify(
  {
    "@context": "https://schema.org",
    "@type": "MedicalBusiness",
    name: c.name,
    address: { "@type": "PostalAddress", streetAddress: c.addressLine, addressLocality: c.city, addressRegion: c.state, postalCode: c.zip },
    telephone: c.intakePhone,
    inLanguage: "es-US",
  },
  null,
  2,
)}
\`\`\`
`,
      };
    case "partner_packet":
      return {
        title: `Información de referidos para profesionales — ${c.name}`,
        bodyMd: `${ES_MACHINE_AUTHORED_NOTE}
# Información de referidos para socios profesionales
**${f.orgName} · ${c.name}**
${c.addressLine}, ${c.city}, ${c.state} ${c.zip}

## Área de servicio
Atendemos a familias que viven a aproximadamente ${c.serviceRadiusMiles} millas del centro (ZCTA del área de servicio: ${f.serviceAreaZctas.join(", ") || "disponibles a solicitud"}).

## Servicios en esta ubicación
- ${modesEs(f)}
${agesEs(f) ? `- ${agesEs(f)}\n` : ""}
## Planes de seguro
${payerListEs(f)}

${PAYER_CAVEAT_ES}

## Cómo referir a una familia
- Comparta con la familia nuestros datos de contacto de admisión, o pídale a la familia que se comunique con nosotros directamente.
- **No envíe información clínica, expedientes ni datos del seguro por correo electrónico común ni en hojas de fax.** Nuestro equipo de admisión le indicará un canal seguro.
${f.referralCode ? `- Opcional: las familias pueden mencionar el código de referencia **${f.referralCode}** para que contemos los referidos de forma agregada. Nunca compartimos la situación de una familia en particular con los socios que refieren.\n` : ""}
## Próximos pasos
Nuestro equipo de admisión se comunica con la familia, revisa sus preferencias de horario y nuestro personal verifica los beneficios y cualquier autorización requerida. No damos tiempos de espera ni prometemos fechas de inicio por adelantado.

## Contacto de admisión
- Teléfono: ${c.intakePhone}
- Correo electrónico: ${c.intakeEmail}

_No ofrecemos regalos, pagos ni nada de valor a cambio de referidos._

${DEMO_NOTICE_ES}
`,
      };
    case "referral_email":
      return {
        title: `Borrador de correo de presentación — ${c.name}`,
        bodyMd: `${ES_MACHINE_AUTHORED_NOTE}
**Asunto:** Información de referidos para ${c.name}

Hola${f.partnerName ? `, equipo de ${f.partnerName}` : ""}:

Le escribo de parte de ${f.orgName} para compartir información actualizada sobre los servicios de ABA en ${c.name} (${c.city}, ${c.state}). Nos gustaría ser un recurso para las familias con las que ustedes trabajan.

- Servicios: ${modesEs(f)}
- Área de servicio: aproximadamente ${c.serviceRadiusMiles} millas alrededor del centro
- Planes cuya participación confirmó nuestro personal: ${f.verifiedPayers.map((p) => p.name).join(", ") || "comuníquese con el equipo de admisión"} (sujeto a la verificación de los beneficios de cada familia)

Adjuntamos nuestra hoja de referidos de una página como referencia. No incluya datos de pacientes en el correo electrónico; las familias pueden comunicarse directamente con nuestro equipo de admisión al ${c.intakePhone}.

Atentamente,
[Nombre del miembro del personal], ${f.orgName}

_BORRADOR: requiere revisión humana. El envío está desactivado en esta demostración._
`,
      };
    case "internal_plan": {
      const m = f.mission;
      return {
        title: `Plan interno de crecimiento — ${m?.title ?? c.name}`,
        bodyMd: `${ES_MACHINE_AUTHORED_NOTE}
# Plan interno: ${m?.title ?? c.name}

## Evidencia (de métricas guardadas)
${(m?.evidence ?? []).map((e) => `- **${e.label}**: ${e.numerator}${e.denominator != null ? ` / ${e.denominator}` : ""} (${e.timeRange}; métrica \`${e.metricKey}\`)`).join("\n") || "- No hay evidencia adjunta"}

## Explicación
${m?.explanation ?? ""}

## Acción propuesta
${m?.proposedAction ?? ""}

## Salvaguarda
${m?.guardrail ?? ""}

## Medición
- Hipótesis: ${m?.experiment?.hypothesis ?? "—"}
- Métrica principal: \`${m?.experiment?.primaryMetric ?? "—"}\` en el panel de CareFlow
- Salvaguardas: ${(m?.experiment?.guardrails ?? []).map((g) => `\`${g}\``).join(", ") || "—"}

## Lista de verificación de revisión
- [ ] Operaciones confirmó la capacidad verificada actual (${f.verifiedHoursAvailable ?? "no verificada"} h directas/sem al ${dateOnlyEs(f.capacityVerifiedAt)})
- [ ] Detalles de los planes de seguro verificados dentro de la política
- [ ] No se usaron ni compartieron datos a nivel de familia
- [ ] Responsable y fecha de revisión asignados

## Condiciones para detener
- La capacidad verificada baja del umbral de la misión
- La mediana del tiempo de primera respuesta empeora más allá del SLA
- Aumenta la tasa de cierres sin resolución
`,
      };
    }
  }
}

export type ValidationIssue = { severity: "error" | "warning"; message: string; excerpt?: string };
export type ValidationResult = { status: "pass" | "needs_review"; issues: ValidationIssue[] };

/** Spanish rules: Unicode-aware word boundaries (JS `\b` treats accented letters as non-word). */
const es = (src: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, "iu");

/** Prohibited-claim rules for both draft locales (en-US and es-US); every draft is checked against all of them. */
const BANNED: [RegExp, string][] = [
  [/\bguarantee[ds]?\b/i, "Outcome or access guarantees are not allowed"],
  [/\bcure[sd]?\b/i, "Cure claims are not allowed"],
  [/\bno wait(ing)?\s?list\b|\bno wait\b/i, "Wait-time claims are not verified"],
  [/\b(immediate|instant)\s+(openings?|availability|start)\b|\bopenings? (today|now)\b|\bstart (this|next) week\b/i, "Availability/timeframe promises are not allowed"],
  [/\b(gift card|referral fee|per referral|commission|reward|incentive)\b/i, "Referral remuneration language is not allowed"],
  [/\btestimonial\b|\b5[- ]star\b|\b#1\b|\bbest (aba|provider|center)\b/i, "Testimonials/superlatives are not verifiable"],
  [/\b(diagnos(e|is)|treat(s|ment)? autism|recover(y|ed))\b/i, "Medical/clinical claims require clinical review"],
  [/\bHIPAA[\s-]+(compliant|certified|compliance)\b|\b(compliant|complies|compliance) with HIPAA\b/i, "Compliance claims (e.g. HIPAA) are not allowed"],
  // es-US
  [es("garantiza(?:do|da|dos|das|mos|n|r)?|garant[ií]as?"), "Outcome or access guarantees are not allowed"],
  [es("cura(?:r|mos|n|s|do|da|dos|das)?|curaci[oó]n"), "Cure claims are not allowed"],
  [es("sin\\s+(?:lista\\s+de\\s+)?espera"), "Wait-time claims are not verified"],
  [
    es("(?:cupos?|vacantes?|lugares|espacios|disponibilidad)\\s+(?:inmediat[oa]s?|hoy|ahora)|inicio\\s+inmediato|(?:comience|empiece|inicie|empezar|comenzar|iniciar)\\s+(?:esta|la\\s+pr[oó]xima)\\s+semana"),
    "Availability/timeframe promises are not allowed",
  ],
  [
    es("tarjetas?\\s+de\\s+regalo|tarifas?\\s+por\\s+(?:referidos?|referencias?)|pagos?\\s+por\\s+(?:cada\\s+)?(?:referidos?|referencias?)|por\\s+cada\\s+(?:referido|referencia)|comisi[oó]n(?:es)?|recompensas?|incentivos?|bonos?\\s+por\\s+(?:referidos?|referencias?)"),
    "Referral remuneration language is not allowed",
  ],
  [es("testimonios?|(?:5|cinco)\\s+estrellas|(?:el|la|los|las)\\s+mejor(?:es)?\\s+(?:centros?|proveedor(?:es)?|terapias?|cl[ií]nicas?)|n[uú]mero\\s+(?:1|uno)"), "Testimonials/superlatives are not verifiable"],
  [es("diagn[oó]stic(?:o|a|ar|amos)s?|trata(?:r|mos|miento)\\s+(?:el|del)\\s+autismo|recupera(?:ci[oó]n|do|da|r)"), "Medical/clinical claims require clinical review"],
  [
    es("cumpl(?:e|en|imos)\\s+(?:con\\s+)?(?:la\\s+)?(?:ley\\s+)?HIPAA|(?:conforme|conformidad|cumplimiento)\\s+(?:a|con|de)\\s+(?:la\\s+)?(?:ley\\s+)?HIPAA|certificad[oa]s?\\s+(?:por|en|de)\\s+(?:la\\s+)?HIPAA"),
    "Compliance claims (e.g. HIPAA) are not allowed",
  ],
];

const ES_TIMEFRAME = new RegExp(es("(?:en|dentro\\s+de)\\s+(?:un\\s+plazo\\s+de\\s+)?\\d+\\s+(?:d[ií]as?|semanas?|horas?)(?:\\s+h[aá]biles)?").source, "giu");
const ES_CAPACITY = new RegExp(es("\\d+(?:[.,]\\d+)?\\s*(?:horas|cupos|lugares|espacios)\\s+(?:disponibles|libres|abiertos)").source, "giu");

/** Validate every payer, location, capacity and timeframe claim against verified records. */
export function validateDraft(bodyMd: string, f: VerifiedFacts, kind?: DraftKind): ValidationResult {
  const internal = kind === "internal_plan"; // internal plans may cite capacity/timeframes; never shared externally
  const issues: ValidationIssue[] = [];
  const text = bodyMd.replace(/```[\s\S]*?```/g, ""); // structured data block checked separately
  for (const [re, msg] of BANNED) {
    const m = text.match(re);
    if (m) issues.push({ severity: "error", message: msg, excerpt: m[0] });
  }
  for (const name of f.otherPayers) {
    if (name && text.toLowerCase().includes(name.toLowerCase())) {
      issues.push({ severity: "error", message: `"${name}" is not verified as accepted at this site`, excerpt: name });
    }
  }
  const zips = new Set([f.center.zip, ...f.serviceAreaZctas]);
  for (const m of text.matchAll(/\b\d{5}\b/g)) {
    if (!zips.has(m[0])) issues.push({ severity: "warning", message: `ZIP/ZCTA ${m[0]} is not in the verified service area`, excerpt: m[0] });
  }
  for (const m of internal ? [] : [...text.matchAll(/\b(?:within|in)\s+\d+\s+(?:business\s+)?(?:days?|weeks?|hours?)\b/gi), ...text.matchAll(ES_TIMEFRAME)]) {
    issues.push({ severity: "error", message: "Timeframe claim cannot be verified", excerpt: m[0] });
  }
  for (const m of internal ? [] : [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:open|available)\s+(?:hours|slots|spots)\b/gi), ...text.matchAll(ES_CAPACITY)]) {
    issues.push({ severity: "error", message: "Capacity claims must not be published externally", excerpt: m[0] });
  }
  if (!f.verifiedPayers.length && /verified by staff|verificada por el personal/i.test(text)) {
    issues.push({ severity: "error", message: "Payer verification claimed but none on record" });
  }
  return { status: issues.some((i) => i.severity === "error") || issues.length ? "needs_review" : "pass", issues };
}
