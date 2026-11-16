import { createFileRoute } from "@tanstack/react-router";
import bundledTrends from "@/data/trends.json";

const GITHUB_REPO = "teomotta88-cloud/trendzn-allianz-direct";
const TRENDS_PATH = "src/data/trends.json";
const REF = "main";
const CACHE_TTL_MS = 60_000;
const GITHUB_TIMEOUT_MS = 8_000;
// Dopo un errore di GitHub non si riprova per qualche secondo: evita richieste lente a raffica.
const RETRY_AFTER_ERROR_MS = 10_000;

type TrendsData = unknown;
type Source = "github" | "github-cache" | "github-stale" | "bundled";

// Cache in memoria (per istanza/isolate): l'ultima copia letta da GitHub.
let cache: { data: TrendsData; at: number } | null = null;
// Lettura in corso, condivisa tra richieste concorrenti per non moltiplicare le chiamate a GitHub.
let inflight: Promise<TrendsData> | null = null;
let lastErrorAt = 0;

async function fetchFromGitHub(): Promise<TrendsData> {
  // Le variabili d'ambiente si leggono dentro l'handler (Cloudflare Workers).
  const token = process.env["GITHUB_TOKEN"];
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${TRENDS_PATH}?ref=${REF}`;

  const request = (withToken: boolean) => {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.raw+json",
      "User-Agent": "trendzn-bot",
    };
    if (withToken && token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(url, { headers, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) });
  };

  let res = await request(true);
  if (res.status === 401 && token) {
    // Token scaduto o non valido: se il repo è pubblico la lettura funziona comunque senza.
    console.error("[trends-json] GITHUB_TOKEN rifiutato da GitHub (401), riprovo senza token");
    res = await request(false);
  }
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data: unknown = await res.json();
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("trends.json da GitHub non è un oggetto JSON");
  }
  return data;
}

function fallback(): { data: TrendsData; source: Source } {
  if (cache) return { data: cache.data, source: "github-stale" };
  return { data: bundledTrends, source: "bundled" };
}

async function loadTrends(): Promise<{ data: TrendsData; source: Source }> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return { data: cache.data, source: "github-cache" };
  }

  if (now - lastErrorAt < RETRY_AFTER_ERROR_MS) {
    return fallback();
  }

  try {
    inflight ??= fetchFromGitHub().finally(() => {
      inflight = null;
    });
    const data = await inflight;
    cache = { data, at: Date.now() };
    return { data, source: "github" };
  } catch (err) {
    console.error(`[trends-json] lettura da GitHub fallita: ${String(err).slice(0, 300)}`);
    lastErrorAt = Date.now();
    return fallback();
  }
}

export const Route = createFileRoute("/api/public/hooks/trends-json")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { data, source } = await loadTrends();
          return Response.json(data, {
            headers: {
              "Cache-Control": "public, max-age=60",
              "X-Trends-Source": source,
            },
          });
        } catch (err) {
          console.error(`[trends-json] errore: ${String(err).slice(0, 300)}`);
          return Response.json({ error: String(err).slice(0, 200) }, { status: 500 });
        }
      },
    },
  },
});
