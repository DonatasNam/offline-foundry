import { put, get } from "./db.js";

/**
 * Accepts whatever a QR or paste can contain and resolves it to the payload
 * URL: the JSON Grab landing URL (query parameter f), or a direct .json URL.
 * Returns null for anything else.
 */
export function extractPayloadUrl(text) {
  try {
    const url = new URL(text.trim());
    const f = url.searchParams.get("f");
    if (f && f.startsWith("/") && !f.includes("..")) return new URL(f, url.origin).href;
    if (url.pathname.endsWith(".json")) return url.href;
    return null;
  } catch {
    return null;
  }
}

export async function fetchPayload(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("The link did not return JSON.");
  if (data.revoked) throw new Error("This link has expired. Ask for a fresh QR.");
  if (!data.schemaVersion || !data.uuid) throw new Error("Not a JSON Grab payload.");
  return data;
}

/** Fresh local tracking state derived from a payload (sync resets tracking). */
export function initialState(payload) {
  const uses = {};
  (payload.items ?? []).forEach((item, index) => {
    if (item.uses) uses[index] = item.uses.value ?? 0;
  });
  return {
    hp: { value: payload.hp?.value ?? 0, temp: payload.hp?.temp ?? 0 },
    slots: Object.fromEntries(
      Object.entries(payload.slots ?? {}).map(([level, slot]) => [level, slot.value ?? 0])
    ),
    uses
  };
}

/** Best effort portrait caching so the sheet has an image offline. */
async function cachePortrait(payload) {
  if (!payload.img || !("caches" in window)) return;
  try {
    const cache = await caches.open("of-portraits");
    await cache.add(new Request(payload.img, { mode: "no-cors" }));
  } catch {
    /* offline portraits are a nicety, never an error */
  }
}

/** Validate, store (keyed by uuid) and return the record. */
export async function importPayload(payload, sourceUrl = null) {
  if (payload.kind !== "actor") {
    throw new Error("Only actor payloads are supported so far.");
  }
  const existing = await get(payload.uuid);
  const record = {
    uuid: payload.uuid,
    payload,
    state: initialState(payload),
    sourceUrl: sourceUrl ?? existing?.sourceUrl ?? null,
    savedAt: Date.now()
  };
  await put(record);
  cachePortrait(payload);
  try { await navigator.storage?.persist?.(); } catch { /* advisory only */ }
  return { record, updated: !!existing };
}

/** Full pipeline for a scanned or pasted link. */
export async function importFromText(text) {
  const url = extractPayloadUrl(text);
  if (!url) throw new Error("That does not look like a JSON Grab link.");
  const payload = await fetchPayload(url);
  return importPayload(payload, url);
}

/** Re-fetch a stored character from its last known link. */
export async function refresh(record) {
  if (!record.sourceUrl) throw new Error("No link stored. Scan a fresh QR.");
  const payload = await fetchPayload(record.sourceUrl);
  return importPayload(payload, record.sourceUrl);
}
