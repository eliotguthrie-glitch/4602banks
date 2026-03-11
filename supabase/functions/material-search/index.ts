import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query, location = "New Orleans, LA" } = await req.json();
    if (!query) {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const TAX_RATE = 0.0945; // New Orleans combined sales tax

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2025-04-15",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250514",
        max_tokens: 1024,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 5,
          },
        ],
        messages: [
          {
            role: "user",
            content: `Search for "${query}" available to buy near ${location}. Find real current prices from major retailers (Home Depot, Lowe's, Menards, Amazon, local stores).

Return ONLY a JSON array (no markdown, no explanation) with up to 5 results:
[{
  "store": "Store Name",
  "product": "Exact product name",
  "price": 29.99,
  "url": "https://...",
  "in_stock": true,
  "notes": "brief note about availability or shipping"
}]

Important:
- price must be a number (no $ sign), the pre-tax shelf price
- Only include results with real prices you found
- Prefer local/in-store pickup options near ${location}
- If you can't find exact matches, find the closest alternatives`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", errText);
      return new Response(JSON.stringify({ error: "AI search failed", detail: errText }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();

    // Extract text from response content blocks
    let resultText = "";
    for (const block of data.content || []) {
      if (block.type === "text") {
        resultText += block.text;
      }
    }

    // Parse JSON from response (handle markdown code blocks)
    let results = [];
    try {
      const jsonMatch = resultText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        results = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("Failed to parse results:", resultText);
    }

    // Add tax calculations
    results = results.map((r: any) => ({
      ...r,
      price: Number(r.price) || 0,
      tax: Math.round((Number(r.price) || 0) * TAX_RATE * 100) / 100,
      total: Math.round((Number(r.price) || 0) * (1 + TAX_RATE) * 100) / 100,
    }));

    return new Response(JSON.stringify({ results, query, location, tax_rate: TAX_RATE }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
