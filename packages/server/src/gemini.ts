import type { HazardType } from "@zephyr/domain";

export type Classification = {
  hazardType: HazardType;
  severity: "low" | "medium" | "high";
  confidence: number;
  authenticityFlags: string[];
  source: "gemini" | "heuristic";
};

/** Gemini when GEMINI_API_KEY is set; otherwise a deterministic heuristic. */
export async function classifyPhoto(bytes: Buffer, hint: HazardType): Promise<Classification> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return heuristic(bytes, hint);
  }
  try {
    const b64 = bytes.toString("base64");
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Classify this air-pollution photo. Return JSON only: {"hazardType":"smoke|dust|haze|fire|trash_fire|construction|other","severity":"low|medium|high","confidence":0-1,"authenticityFlags":["screenshot"|"edited"|"stock"]}. Hint from reporter: ${hint}`,
                },
                { inline_data: { mime_type: "image/jpeg", data: b64 } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) return heuristic(bytes, hint);
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return heuristic(bytes, hint);
    const parsed = JSON.parse(jsonMatch[0]) as Classification;
    return { ...parsed, source: "gemini" };
  } catch {
    return heuristic(bytes, hint);
  }
}

function heuristic(bytes: Buffer, hint: HazardType): Classification {
  const flags: string[] = [];
  // Tiny heuristic: very small files often screenshots/placeholders
  if (bytes.length < 8_000) flags.push("screenshot");
  return {
    hazardType: hint,
    severity: flags.length ? "low" : "medium",
    confidence: flags.length ? 0.35 : 0.7,
    authenticityFlags: flags,
    source: "heuristic",
  };
}

export async function generateZoneBrief(evidence: Record<string, unknown>, lang: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  const fallback = `Air quality update (${lang}): nearest station and open hotspots are summarized from live evidence. ${JSON.stringify(evidence).slice(0, 280)}`;
  if (!key) return fallback;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Write a short resident summary in language code ${lang} using ONLY this evidence JSON. No invented numbers.\n${JSON.stringify(evidence)}`,
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) return fallback;
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export type WorkOrderDraft = {
  priority: "immediate" | "within_24h" | "routine";
  summaryEn: string;
  summaryLocal: string | null;
  agency: string;
  repeat: boolean;
  source: "gemini" | "fallback";
};

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

function priorityFromAqi(aqi: number | null): WorkOrderDraft["priority"] {
  const value = aqi ?? 0;
  if (value >= 301) return "immediate";
  if (value >= 201) return "within_24h";
  return "routine";
}

export async function draftWorkOrder(evidence: {
  city: string;
  language: string;
  hazardType: string;
  reason: string | null;
  aqi: number | null;
  repeat: boolean;
}): Promise<WorkOrderDraft> {
  const priority = priorityFromAqi(evidence.aqi);
  const fallback: WorkOrderDraft = {
    priority,
    summaryEn: `Investigate ${evidence.hazardType} in ${evidence.city}. Evidence: ${evidence.reason ?? "ambient"}. AQI ${evidence.aqi ?? "unknown"}.${evidence.repeat ? " Repeat hotspot." : ""}`,
    summaryLocal: null,
    agency: "Municipal field team",
    repeat: evidence.repeat,
    source: "fallback",
  };
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return fallback;
  try {
    const res = await fetch(`${GEMINI_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Return JSON only: {"summaryEn":"","summaryLocal":"","agency":""}. Use only this evidence object. Do not choose priority or repeat.\n${JSON.stringify(evidence)}`,
              },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as {
      summaryEn?: unknown;
      summaryLocal?: unknown;
      agency?: unknown;
    };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    const summaryEn = typeof parsed.summaryEn === "string" ? parsed.summaryEn.trim() : "";
    const agency = typeof parsed.agency === "string" ? parsed.agency.trim() : "";
    if (!summaryEn || !agency) return fallback;
    const summaryLocal = typeof parsed.summaryLocal === "string" && parsed.summaryLocal.trim() ? parsed.summaryLocal.trim() : null;
    return {
      priority,
      summaryEn,
      summaryLocal,
      agency,
      repeat: evidence.repeat,
      source: "gemini",
    };
  } catch {
    return fallback;
  }
}

const COPILOT_TOOL_DESCRIPTIONS: Record<string, string> = {
  incidents: "Open air-quality incidents",
  stations: "Monitoring stations and current readings",
  wind: "Current wind direction and speed",
  fires: "Active fire detections",
  forecasts: "City air-quality forecasts",
  upwind: "Upwind sources linked to incidents",
};

type GeminiPart = {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
};

function toToolResponse(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { result: value ?? null };
}

function offlineCopilot(question: string): { answer: string; toolsUsed: string[] } {
  return {
    answer: `Copilot (offline). Tools used: none. Question: ${question}. Evidence: {}`,
    toolsUsed: [],
  };
}

export async function runCopilot(
  question: string,
  tools: Record<string, (args?: Record<string, unknown>) => unknown | Promise<unknown>>,
): Promise<{ answer: string; toolsUsed: string[] }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return offlineCopilot(question);

  const names = Object.keys(tools);
  const functionDeclarations = names.map((name) => ({
    name,
    description: COPILOT_TOOL_DESCRIPTIONS[name] ?? `Read ${name}`,
    parameters: {
      type: "object",
      properties: {
        cityId: { type: "string", description: "City id, for example delhi" },
        h3: { type: "string", description: "H3 cell id" },
      },
    },
  }));
  const contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [
    {
      role: "user",
      parts: [
        {
          text: `You are a municipal air-quality operator copilot. Call tools for facts, then answer in plain text using only those results. Do not invent numbers. Question: ${question}`,
        },
      ],
    },
  ];
  const toolsUsed: string[] = [];

  try {
    for (let round = 0; round < 4; round++) {
      const res = await fetch(`${GEMINI_URL}?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          tools: [{ functionDeclarations }],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) break;
      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
      };
      const parts = body.candidates?.[0]?.content?.parts ?? [];
      const calls = parts.filter((part) => {
        const name = part.functionCall?.name;
        return !!name && Object.hasOwn(tools, name);
      });
      if (calls.length === 0) {
        const answer = parts.map((part) => part.text ?? "").join("").trim();
        return { answer: answer || "No answer", toolsUsed };
      }
      contents.push({ role: "model", parts });
      const responses: GeminiPart[] = [];
      for (const part of calls) {
        const name = part.functionCall!.name!;
        const fn = tools[name];
        if (!fn) continue;
        toolsUsed.push(name);
        try {
          responses.push({ functionResponse: { name, response: toToolResponse(await fn(part.functionCall?.args)) } });
        } catch (err) {
          responses.push({
            functionResponse: {
              name,
              response: { error: err instanceof Error ? err.message : "tool_failed" },
            },
          });
        }
      }
      if (responses.length === 0) break;
      contents.push({ role: "user", parts: responses });
    }
  } catch {
    if (toolsUsed.length === 0) return offlineCopilot(question);
  }

  return {
    answer: toolsUsed.length
      ? `Copilot (offline). Tools used: ${toolsUsed.join(", ")}. Question: ${question}.`
      : offlineCopilot(question).answer,
    toolsUsed,
  };
}
