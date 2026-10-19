import { renderDraft, validateDraft, type DraftKind, type VerifiedFacts } from "@careflow/core";

/**
 * Optional AI narrative adapter. The payload is built from an explicit
 * allowlist of PUBLIC business facts and aggregate evidence only — never
 * inquiry details, aliases, notes or anything family-level.
 */
export type LlmPayload = {
  task: "paraphrase_draft";
  kind: DraftKind;
  facts: {
    orgName: string;
    centerName: string;
    city: string;
    state: string;
    serviceModes: string[];
    serviceRadiusMiles: number;
    verifiedPayerNames: string[];
    intakePhone: string;
    missionTitle: string | null;
    aggregateEvidence: { label: string; numerator: number; denominator: number | null; timeRange: string }[];
  };
  baseDraft: string;
  instructions: string;
};

export function buildLlmPayload(kind: DraftKind, facts: VerifiedFacts, baseDraft: string): LlmPayload {
  return {
    task: "paraphrase_draft",
    kind,
    facts: {
      orgName: facts.orgName,
      centerName: facts.center.name,
      city: facts.center.city,
      state: facts.center.state,
      serviceModes: [...facts.center.serviceModes],
      serviceRadiusMiles: facts.center.serviceRadiusMiles,
      verifiedPayerNames: facts.verifiedPayers.map((p) => p.name),
      intakePhone: facts.center.intakePhone,
      missionTitle: facts.mission?.title ?? null,
      aggregateEvidence: (facts.mission?.evidence ?? []).map((e) => ({
        label: e.label,
        numerator: e.numerator,
        denominator: e.denominator,
        timeRange: e.timeRange,
      })),
    },
    baseDraft,
    instructions:
      "Improve readability only. Do not add any fact, number, payer, timeframe, availability, testimonial, outcome or medical claim not present in facts. Keep all caveats.",
  };
}

export type DraftOutput = { title: string; bodyMd: string; generator: "template" | "llm" };

export interface ContentDraftProvider {
  name: string;
  generate(kind: DraftKind, facts: VerifiedFacts): Promise<DraftOutput>;
}

export const templateProvider: ContentDraftProvider = {
  name: "template",
  async generate(kind, facts) {
    return { ...renderDraft(kind, facts), generator: "template" };
  },
};

export function createLlmProvider(cfg: { baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch }): ContentDraftProvider {
  return {
    name: "llm",
    async generate(kind, facts) {
      const base = renderDraft(kind, facts);
      const payload = buildLlmPayload(kind, facts, base.bodyMd);
      try {
        const res = await (cfg.fetchImpl ?? fetch)(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: "system", content: payload.instructions },
              { role: "user", content: JSON.stringify(payload) },
            ],
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const text = json.choices?.[0]?.message?.content?.trim();
        if (!text) throw new Error("empty");
        // Fact/claim validator gate: any new unsupported claim => fall back to the template.
        if (validateDraft(text, facts).issues.some((i) => i.severity === "error")) throw new Error("validator rejected LLM output");
        return { title: base.title, bodyMd: text, generator: "llm" };
      } catch {
        return { ...base, generator: "template" };
      }
    },
  };
}

export function contentProviderFromEnv(env: Record<string, string | undefined> = process.env): ContentDraftProvider {
  if (env.LLM_ENABLED === "true" && env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL) {
    return createLlmProvider({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
  }
  return templateProvider;
}
