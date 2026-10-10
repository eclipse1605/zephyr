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

export async function runCopilot(question: string, toolsUsed: string[]): Promise<{ answer: string; toolsUsed: string[] }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return {
      answer: `Copilot (offline): I would use tools [${toolsUsed.join(", ")}] to answer: ${question}`,
      toolsUsed,
    };
  }
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
                text: `You are a municipal air-quality operator copilot. Available tools: ${toolsUsed.join(", ")}. Question: ${question}. List which tools you would use and answer briefly.`,
              },
            ],
          },
        ],
      }),
    },
  );
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return {
    answer: body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "No answer",
    toolsUsed,
  };
}
