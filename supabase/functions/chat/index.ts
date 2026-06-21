import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const requestLog = new Map<string, number[]>();
const MAX_REQUESTS_PER_MINUTE = 10;
const MAX_BODY_BYTES = 262_144;
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

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

type ChatMessage = { role: string; content: string };

function normalizedMessages(systemPrompt: string, messages: ChatMessage[]) {
  return [
    { role: "system", content: systemPrompt },
    ...messages
      .filter((message) => typeof message?.content === "string" && message.content.trim())
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      })),
  ];
}

async function callLovableGateway(systemPrompt: string, messages: ChatMessage[]) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: normalizedMessages(systemPrompt, messages),
      stream: false,
      temperature: 0.4,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Lovable gateway failed with ${response.status}: ${detail.slice(0, 500)}`);
  }

  const payload = await response.json();
  const message = payload?.choices?.[0]?.message?.content;
  if (!message) throw new Error("Lovable gateway returned an empty response");
  return String(message);
}

async function callGroq(systemPrompt: string, messages: ChatMessage[]) {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("GROQ_MODEL") || DEFAULT_GROQ_MODEL,
      messages: normalizedMessages(systemPrompt, messages),
      stream: false,
      temperature: 0.35,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Groq failed with ${response.status}: ${detail.slice(0, 500)}`);
  }

  const payload = await response.json();
  const message = payload?.choices?.[0]?.message?.content;
  if (!message) throw new Error("Groq returned an empty response");
  return String(message);
}

async function generateChatResponse(systemPrompt: string, messages: ChatMessage[]) {
  const providers = Deno.env.get("AI_PROVIDER_ORDER")?.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)
    || ["lovable", "groq"];
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      if (provider === "lovable" || provider === "gemini") {
        return await callLovableGateway(systemPrompt, messages);
      }
      if (provider === "groq") {
        return await callGroq(systemPrompt, messages);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider}: ${message}`);
      console.error("AI provider failed:", provider, message);
    }
  }

  throw new Error(`Aucun fournisseur IA disponible. ${errors.join(" | ")}`);
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

    const message = await generateChatResponse(systemPrompt, messages || []);

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
