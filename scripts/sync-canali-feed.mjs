// Replica del workflow n8n "Trendzn Sync": monitora gli account social
// elencati in trends.json (canali_inspo, influencer_profiles, canali_cliente)
// via RSS-Bridge e scrive i nuovi post trovati in trends.json su GitHub.
//
// Variabili d'ambiente:
//   GITHUB_TOKEN     richiesta, token con permesso "contents: write" sul repo
//   SUPABASE_URL, SUPABASE_ANON_KEY
//                    opzionali (ma consigliate): chiave anon/publishable di Supabase,
//                    mai la service role. Servono a leggere i canali inseriti dal portale
//                    (trend_submissions approved per "canali-inspo" e "influencer",
//                    editorial_client_channels) e a unirli a trends.json prima del sync.
//   RSS_BRIDGE_BASE  opzionale, URL base dell'istanza RSS-Bridge da interrogare
//                    (default: RSS-Bridge lanciato come service container dal
//                    workflow stesso, così non serve più un'istanza esterna
//                    sempre accesa da pagare — vedi .github/workflows/sync-canali-feed.yml)
//
// Eseguito da .github/workflows/sync-canali-feed.yml su schedule (ogni 3h)
// o manualmente via workflow_dispatch.

const REPO = "teomotta88-cloud/trendzn-allianz-direct";
const TRENDS_PATH = "src/data/trends.json";
const RSS_BRIDGE_BASE = process.env.RSS_BRIDGE_BASE || "http://localhost:3000/";
const MAX_POSTS_PER_CHANNEL = 15;

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Manca GITHUB_TOKEN nell'ambiente.");
  process.exit(1);
}

const ghHeaders = {
  Authorization: `token ${token}`,
  Accept: "application/vnd.github.v3+json",
};

async function readTrendsJson() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDS_PATH}`, {
    headers: ghHeaders,
  });
  if (!res.ok) throw new Error(`Lettura trends.json fallita: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const trends = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
  return { trends, sha: data.sha };
}

async function writeTrendsJson(trends, sha) {
  const content = Buffer.from(JSON.stringify(trends, null, 2)).toString("base64");
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDS_PATH}`, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "chore: sync social posts [trendzn-bot]",
      content,
      sha,
    }),
  });
  if (!res.ok) throw new Error(`Scrittura trends.json fallita: ${res.status} ${await res.text()}`);
}

function normalizeHandle(handle) {
  return handle?.startsWith("@") ? handle.slice(1) : handle;
}

function isPostUrl(url) {
  return /\/p\/|\/reel\/|\/reels\/|\/video\/|\/watch/.test(url);
}

function detectPlatform(url) {
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  return "web";
}

// "title" arriva troncato da RSS-Bridge; "content_html" contiene la caption
// integrale (dopo i tag <video>/<img> dell'anteprima media), quindi va preferito.
function fullCaption(item) {
  const html = item.content_html || "";
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
  return text || (item.title || "").trim() || null;
}

function rssBridgeUrl(platform, handle) {
  return platform === "instagram"
    ? `${RSS_BRIDGE_BASE}?action=display&bridge=Instagram&context=Username&u=${handle}&format=JSON`
    : `${RSS_BRIDGE_BASE}?action=display&bridge=TikTok&context=By+user&username=${handle}&format=JSON`;
}

async function fetchFeed(platform, handle) {
  const url = rssBridgeUrl(platform, handle);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`Feed ${platform}/${handle} fallito: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.items ?? [];
  } catch (err) {
    console.error(`Feed ${platform}/${handle} errore: ${String(err)}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Canali inseriti dal portale (Supabase)
// ---------------------------------------------------------------------------

// Stesso mapping usato da src/routes/api/public/hooks/add-client-channel.ts
const CANALE_TO_PLATFORM = {
  IG: "instagram",
  IGS: "instagram",
  FB: "facebook",
  TT: "tiktok",
  LK: "linkedin",
  X: "x",
  YT: "youtube",
};

const TRACKING_PARAMS = [
  "igsh", "igshid", "utm_source", "utm_medium", "utm_campaign", "utm_content",
  "utm_term", "fbclid", "is_from_webapp", "sender_device", "trk", "trackingId", "rcm",
];

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    TRACKING_PARAMS.forEach((p) => u.searchParams.delete(p));
    u.pathname = u.pathname.replace(/\/$/, "") || "/";
    return u.toString();
  } catch {
    return String(url).replace(/[).,;]+$/, "").trim();
  }
}

// URL senza query string né slash finale, in minuscolo: criterio anti-duplicati
function urlBase(url) {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname.replace(/\/$/, "")).toLowerCase();
  } catch {
    return String(url).split("?")[0].replace(/\/$/, "").toLowerCase();
  }
}

function handleFromUrl(url) {
  const clean = String(url).split("?")[0].replace(/\/$/, "");
  const last = clean.split("/").pop() || "";
  return last.replace(/^@/, "") || url;
}

function slug(handle) {
  return String(handle).replace(/[^a-z0-9]/gi, "-").toLowerCase();
}

// Come nel portale, con LinkedIn in più
function platformFromUrl(url) {
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/linkedin\.com/.test(url)) return "linkedin";
  return "web";
}

// Rifiuta le chiavi di servizio: lo script deve usare solo la chiave anon/publishable.
function isServiceKey(key) {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
      return payload.role === "service_role";
    } catch {
      return false;
    }
  }
  return false;
}

async function supabaseSelect(baseUrl, key, table, query) {
  const headers = { apikey: key, Accept: "application/json" };
  // Le nuove chiavi sb_publishable_ non sono JWT: PostgREST le accetta solo in "apikey".
  // Le chiavi anon legacy (JWT) vanno inviate anche come Bearer.
  if (!key.startsWith("sb_publishable_")) headers.Authorization = `Bearer ${key}`;

  const rows = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${baseUrl}/rest/v1/${table}?${query}&limit=${PAGE}&offset=${offset}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error("risposta non valida (atteso array)");
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

// Legge da Supabase i canali inseriti dal portale e aggiunge a trends.json quelli
// mancanti, con la stessa struttura che crea il portale. Ritorna il numero di
// canali aggiunti. Non lancia mai: gli errori vengono solo loggati.
async function mergeSupabaseChannels(trends) {
  const added = { canali_inspo: 0, influencer_profiles: 0, canali_cliente: 0 };
  const total = () => added.canali_inspo + added.influencer_profiles + added.canali_cliente;

  for (const k of Object.keys(added)) {
    if (!Array.isArray(trends[k])) trends[k] = [];
  }

  const baseUrl = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_ANON_KEY || "").trim();
  if (!baseUrl || !key) {
    console.warn("ATTENZIONE: SUPABASE_URL o SUPABASE_ANON_KEY mancanti, uso solo trends.json.");
    return 0;
  }
  if (isServiceKey(key)) {
    console.warn("ATTENZIONE: SUPABASE_ANON_KEY sembra una chiave di servizio, la ignoro. Usa la chiave anon/publishable.");
    return 0;
  }

  const hasUrl = (list, url) => {
    const base = urlBase(url);
    return list.some((c) => (c.accounts || []).some((a) => urlBase(a.url) === base));
  };

  // trend_submissions: canali-inspo e influencer
  try {
    const rows = await supabaseSelect(
      baseUrl,
      key,
      "trend_submissions",
      "select=id,url,title,industry,section,status&status=eq.approved&section=in.(canali-inspo,influencer)&order=created_at.asc",
    );
    const bySection = { "canali-inspo": 0, influencer: 0 };
    for (const r of rows) if (r.section in bySection) bySection[r.section]++;
    console.log(
      `Supabase trend_submissions (approved): ${rows.length} righe (canali-inspo: ${bySection["canali-inspo"]}, influencer: ${bySection.influencer}).`,
    );
    if (rows.length === 0) {
      console.warn("  0 righe: se ti aspetti dei canali, verifica la policy SELECT per anon su trend_submissions.");
    }

    for (const r of rows) {
      if (!r.url || !/^https?:\/\//.test(r.url)) continue;
      const url = normalizeUrl(r.url.trim());
      const handle = handleFromUrl(url);
      const entry = {
        id: slug(handle),
        name: null,
        urls: [url],
        descrizione: null,
        accounts: [{ platform: platformFromUrl(url), handle, url }],
      };

      if (r.section === "canali-inspo") {
        if (hasUrl(trends.canali_inspo, url)) continue;
        entry.name = (r.title && r.title.trim()) || handle;
        trends.canali_inspo.push(entry);
        added.canali_inspo++;
      } else if (r.section === "influencer") {
        if (hasUrl(trends.influencer_profiles, url)) continue;
        // Nel portale industry = nome influencer, title = cliente (il portale lo
        // riempie con l'handle se vuoto: in quel caso nessun cliente).
        entry.name = (r.industry && r.industry.trim()) || handle;
        const cliente = r.title && r.title.trim() && r.title.trim() !== handle ? r.title.trim() : null;
        trends.influencer_profiles.push({
          id: entry.id,
          name: entry.name,
          cliente,
          urls: entry.urls,
          descrizione: null,
          accounts: entry.accounts,
        });
        added.influencer_profiles++;
      }
    }
  } catch (err) {
    console.error(`Lettura Supabase trend_submissions fallita (proseguo senza): ${String(err)}`);
  }

  // editorial_client_channels
  try {
    const rows = await supabaseSelect(
      baseUrl,
      key,
      "editorial_client_channels",
      "select=id,canale,handle,url&order=created_at.asc",
    );
    console.log(`Supabase editorial_client_channels: ${rows.length} righe.`);

    for (const r of rows) {
      if (!r.url || !r.handle || !/^https?:\/\//.test(r.url.trim())) continue;
      const url = r.url.trim();
      if (hasUrl(trends.canali_cliente, url)) continue;
      const handle = normalizeHandle(r.handle.trim());
      trends.canali_cliente.push({
        id: slug(handle),
        name: handle,
        urls: [url],
        descrizione: null,
        accounts: [{ platform: CANALE_TO_PLATFORM[r.canale] ?? "web", handle, url }],
      });
      added.canali_cliente++;
    }
  } catch (err) {
    console.error(`Lettura Supabase editorial_client_channels fallita (proseguo senza): ${String(err)}`);
  }

  console.log(
    `Canali aggiunti da Supabase: ${total()} (canali_inspo: ${added.canali_inspo}, influencer: ${added.influencer_profiles}, canali_cliente: ${added.canali_cliente}).`,
  );
  return total();
}

const { trends, sha } = await readTrendsJson();

const addedFromSupabase = await mergeSupabaseChannels(trends);

if (!Array.isArray(trends.influencer_profiles)) trends.influencer_profiles = [];
if (!Array.isArray(trends.canali_cliente)) trends.canali_cliente = [];

const lists = [trends.canali_inspo, trends.influencer_profiles, trends.canali_cliente];

// Normalizza handle (rimuovi @) per tutte le liste
for (const list of lists) {
  for (const canale of list) {
    for (const account of canale.accounts) {
      if (account.handle) account.handle = normalizeHandle(account.handle);
    }
  }
}

// Genera la lista univoca di handle Instagram/TikTok da monitorare
const handles = lists
  .flatMap((list) => list.flatMap((c) => c.accounts))
  .filter((a) => a.platform === "instagram" || a.platform === "tiktok")
  .filter((a, i, arr) => arr.findIndex((x) => x.handle === a.handle && x.platform === a.platform) === i)
  .map((a) => ({ handle: normalizeHandle(a.handle), platform: a.platform }));

const perPlatform = handles.reduce((acc, h) => ({ ...acc, [h.platform]: (acc[h.platform] || 0) + 1 }), {});
console.log(
  `Monitoro ${handles.length} account (${Object.entries(perPlatform).map(([k, v]) => `${k}: ${v}`).join(", ") || "nessuno"}).`,
);

const allItems = [];
for (const { handle, platform } of handles) {
  const items = await fetchFeed(platform, handle);
  allItems.push(...items);
}

console.log(`Trovati ${allItems.length} item totali nei feed.`);

let modified = addedFromSupabase > 0;

for (const list of lists) {
  for (const item of allItems) {
    const url = (item.url || item.id || "").trim();
    if (!url || !isPostUrl(url)) continue;

    const handle = normalizeHandle(item.author?.name || "") || null;

    const canale = list.find((c) => c.accounts.some((a) => a.handle === handle));
    if (!canale) continue;

    if (canale.accounts.some((a) => a.url === url)) continue;

    const date = item.date_modified || item.date_published || null;
    const caption = fullCaption(item);

    canale.accounts.push({
      platform: detectPlatform(url),
      handle,
      url,
      date,
      caption,
    });

    const posts = canale.accounts.filter((a) => isPostUrl(a.url));
    if (posts.length > MAX_POSTS_PER_CHANNEL) {
      canale.accounts = canale.accounts.filter((a) => a.url !== posts[0].url);
    }

    modified = true;
  }
}

if (!modified) {
  console.log("Nessuna novità, trends.json non modificato.");
  process.exit(0);
}

await writeTrendsJson(trends, sha);
console.log("trends.json aggiornato su GitHub.");
