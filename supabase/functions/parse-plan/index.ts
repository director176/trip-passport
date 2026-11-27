// Trip Passport · Supabase Edge Function "parse-plan"
// Reads uploaded tickets / bookings / itineraries with Claude and returns a trip as JSON.
// Needs the secret ANTHROPIC_API_KEY (Edge Functions → Secrets).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const PROMPT = (notes: string, today: string) => `You are reading a traveller's documents (flight tickets, hotel vouchers, tour itineraries, visas) to set up a trip-expense app.
Today is ${today}. Extra notes from the traveller: ${notes || "(none)"}.

Return ONLY one JSON object, no prose, in exactly this shape:
{
 "name": "short trip title, e.g. 'Japan · Korea' or 'Paris Getaway'",
 "region": "one word for the region, e.g. Asia, Europe, Gulf",
 "home": {"city": "departure city", "country": "ISO-3166 alpha-2", "lat": number, "lon": number},
 "start": "YYYY-MM-DD (first departure)",
 "returnDate": "YYYY-MM-DD (arrival back home, or last day)",
 "legs": [ { "place": "country name as travellers say it (use 'Hong Kong', 'Macau', 'Singapore' for those)", "country": "ISO alpha-2", "city": "main city/base", "lat": number, "lon": number,
   "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "currency": "ISO-4217 code", "lang": "BCP-47 of what taxi drivers read: zh-Hans, zh-Hant, ja, ko, th, vi, ar, ru, fr, es, it, de, tr, id, ms or en",
   "stay": "hotel name or ''" } ],
 "plan": { "YYYY-MM-DD": "one short line for that day starting with an emoji" },
 "acts": [ { "id": "a01", "date": "YYYY-MM-DD", "e": "emoji", "t": "activity / flight / check-in title", "s": "short detail: flight no · time, or pick-up time" } ],
 "wallet": [
   { "icon": "✈️", "title": "City → City", "sub": "Airline FLT · Ddd D Mon", "rows": [["Departs","AAA T1 · HH:MM"],["Arrives","BBB T2 · HH:MM"],["PNR","..."],["E-ticket (First name)","..."],["Baggage","..."]] },
   { "icon": "🏨", "title": "Hotel name", "sub": "City · D–D Mon · board basis", "rows": [["Address","..."],["Phone","..."],["Confirmation","..."],["Check-in / out","D Mon HH:MM → D Mon HH:MM"]] },
   { "icon": "🏠", "title": "City → Home city", "sub": "Airline FLT · Ddd D Mon", "rows": [["Departs","..."],["Arrives","..."],["PNR","..."]] },
   { "icon": "📞", "title": "Help", "sub": "Travel agent & emergency", "rows": [["Agent","name · phone"]] } ],
 "cards": [ { "id": "short-id", "city": "the leg's place", "kind": "hotel|airport|sight", "title": "English name", "zh": "name in the local script drivers read (blank for Latin-script countries)", "zhAddr": "local-script address ONLY if you are confident, else ''", "en": "English name and address", "leg": "the leg's place for hotels, else omit" } ]
}
Rules:
- Use only facts found in the documents or notes; leave a field "" (or omit the row) when unknown. Never invent PNRs, phone numbers or addresses.
- Use the final outbound flight home ("🏠" card) for returnDate when present.
- legs are in travel order, one per country/territory stay; consecutive legs may share a boundary date.
- Include taxi cards for every hotel and the arrival/departure airports.
- Never include dates of birth, passport numbers, card numbers or other ID numbers.
- Days in "plan" and "acts" must fall between start and returnDate.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    // Only passport members may use the AI (protects your credits)
    const m = await fetch(`${url}/rest/v1/rpc/is_member`, { method: "POST", headers: { apikey: anon, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
    if (!m.ok || (await m.json()) !== true) return json({ error: "Not allowed: sign in with a passport account." }, 403);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY secret is missing in Supabase." }, 500);

    const { files = [], notes = "", today = "" } = await req.json();
    if (!Array.isArray(files) || !files.length) return json({ error: "Attach at least one document." }, 400);
    const content: unknown[] = [];
    for (const f of files.slice(0, 12)) {
      if (!f || typeof f.data !== "string") continue;
      if (f.type === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
      else if (/^image\/(jpeg|png|webp|gif)$/.test(f.type)) content.push({ type: "image", source: { type: "base64", media_type: f.type, data: f.data } });
    }
    if (!content.length) return json({ error: "Only PDFs and photos (JPG/PNG) can be read." }, 400);
    content.push({ type: "text", text: PROMPT(String(notes).slice(0, 1500), String(today).slice(0, 10)) });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 12000, messages: [{ role: "user", content }] }),
    });
    const out = await r.json();
    if (!r.ok) return json({ error: (out && out.error && out.error.message) || "The AI request failed." }, 502);
    const text = (out.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a < 0 || b < a) return json({ error: "Couldn't understand the documents. Try clearer files." }, 422);
    return json({ trip: JSON.parse(text.slice(a, b + 1)) });
  } catch (e) {
    return json({ error: String((e && (e as Error).message) || e) }, 500);
  }
});
