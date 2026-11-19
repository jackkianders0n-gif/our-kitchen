// Supabase Edge Function: import-recipe
// Fetches a recipe web page for the app and returns the schema.org Recipe data embedded in it
// (the structured data most recipe sites publish for Google). The browser can't fetch other
// sites directly, which is why this runs here. Only signed-in users of the app can call it.
//
// Deploy:  supabase functions deploy import-recipe --no-verify-jwt
// (the sign-in check happens below, which works with both legacy and new Supabase API keys)

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MAX_BYTES = 5_000_000;

function isBlockedHost(host: string) {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || h.startsWith('[')) return true; // no raw IPs
  return false;
}

// deno-lint-ignore no-explicit-any
function isRecipe(node: any) {
  const t = node?.['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
}
// deno-lint-ignore no-explicit-any
function findRecipeNode(node: any, depth = 0): any {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) { const r = findRecipeNode(n, depth + 1); if (r) return r; }
    return null;
  }
  if (isRecipe(node)) return node;
  for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
    const r = findRecipeNode(node[k], depth + 1); if (r) return r;
  }
  return null;
}

export function extractRecipe(html: string) {
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    let data;
    try { data = JSON.parse(raw); }
    catch { try { data = JSON.parse(raw.replace(/[\u0000-\u001F]+/g, ' ')); } catch { continue; } }
    const r = findRecipeNode(data);
    if (r) {
      return {
        name: r.name, description: r.description, image: r.image, recipeYield: r.recipeYield,
        prepTime: r.prepTime, cookTime: r.cookTime, totalTime: r.totalTime, recipeCategory: r.recipeCategory,
        recipeIngredient: r.recipeIngredient || r.ingredients, recipeInstructions: r.recipeInstructions,
      };
    }
  }
  return null;
}

if (import.meta.main) Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data: auth } = await sb.auth.getUser(token);
  if (!auth?.user) return json({ error: 'Please sign in again.' }, 401);

  let target: URL;
  try {
    const body = await req.json();
    target = new URL(String(body?.url || '').trim());
  } catch { return json({ error: "That doesn't look like a web link." }); }
  if (!/^https?:$/.test(target.protocol) || isBlockedHost(target.hostname)) return json({ error: "That link can't be imported." });

  let res: Response;
  try {
    res = await fetch(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RecipeImporter/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });
  } catch { return json({ error: "Couldn't reach that website." }); }
  if (!res.ok) return json({ error: `That website refused the request (${res.status}).` });

  const reader = res.body?.getReader();
  if (!reader) return json({ error: 'Empty page.' });
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length; chunks.push(value);
    if (size > MAX_BYTES) { await reader.cancel(); break; }
  }
  const buf = new Uint8Array(size); let off = 0;
  for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, size - off)), off); off += c.length; if (off >= size) break; }
  const html = new TextDecoder().decode(buf);

  const recipe = extractRecipe(html);
  if (!recipe) return json({ error: "Couldn't find a recipe on that page. Some sites don't publish their recipes in a readable format." });
  return json({ recipe, url: res.url || target.href });
});
