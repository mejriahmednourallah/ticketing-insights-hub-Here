import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const requestLog = new Map<string, number[]>();
const MAX_REQUESTS_PER_MINUTE = 10;
const MAX_BODY_BYTES = 262_144;

function rateLimited(req: Request): boolean {
  const address = req.headers.get("cf-connecting-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  const now = Date.now();
  const recent = (requestLog.get(address) || []).filter(timestamp => now - timestamp < 60_000);
  if (recent.length >= MAX_REQUESTS_PER_MINUTE) return true;
  recent.push(now);
  requestLog.set(address, recent);
  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const contentLength = Number(req.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "Requête trop volumineuse" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (rateLimited(req)) {
      return new Response(JSON.stringify({ error: "Trop de requêtes. Réessayez dans une minute." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, ticketSummary } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `Tu es un assistant IA expert en analyse de tickets de support technique. Tu réponds en français.

Tu as accès aux données suivantes du tableau de bord de ticketing :
${ticketSummary}

Règles :
- Réponds de manière concise et précise.
- Utilise des nombres et pourcentages quand c'est pertinent.
- Si on te demande des tickets similaires, utilise les données de similarité fournies.
- Si on te demande des métriques, utilise les données du dashboard fournies.
- Formate tes réponses en Markdown avec des tableaux, listes, ou gras quand c'est utile.
- Si tu ne peux pas répondre avec les données fournies, dis-le clairement.
- N'invente jamais de données.`;

    const GEMINI_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

    const geminiBody = {
      contents: [
        {
          role: "user",
          parts: [
            { text: systemPrompt + "\n\n---\n\nResponda en français." },
            ...messages.map((m: { role: string; content: string }) => ({
              text: `${m.role}: ${m.content}`,
            })),
          ],
        },
      ],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    };

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("Gemini error:", response.status, t);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ message: "⚠️ L'assistant IA est temporairement indisponible (limite de requêtes atteinte). Réessayez dans une minute." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Erreur du service IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = await response.json();
    const message = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!message) throw new Error("Le service IA a retourné une réponse vide");

    return new Response(JSON.stringify({ message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
