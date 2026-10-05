/**
 * MyMap JavaScript SDK — real client over the platform's /api/v1 Map API.
 *
 * Works in Node (secret keys) and browsers (public keys, read-only).
 * No mocks: every method performs a real authenticated fetch.
 *
 * Node:
 *   import { MyMap } from "./mymap.js";
 *   const mymap = new MyMap({ apiKey: process.env.MYMAP_SECRET_KEY, baseUrl: "https://YOURDOMAIN" });
 *   const maps = await mymap.listMaps();
 *
 * Browser (public key + embed-style reads):
 *   const mymap = new MyMap({ apiKey: "mk_public_…", baseUrl: "https://YOURDOMAIN" });
 *   const map = await mymap.getMap("map_…");
 *   const locations = await mymap.listLocations("map_…", { type: "landmark" });
 */

export class MyMapError extends Error {
  constructor(status, body) {
    super(body?.error ?? `MyMap API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

const READ_SCOPES = /:read$/;

export class MyMap {
  /** @param {{apiKey: string, baseUrl?: string}} opts */
  constructor({ apiKey, baseUrl = "" }) {
    if (!apiKey) throw new Error("MyMap: apiKey is required");
    if (!apiKey.startsWith("mk_")) {
      throw new Error('MyMap: apiKey must look like "mk_public_…" or "mk_secret_…"');
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.publicKeyMode = apiKey.startsWith("mk_public_");
  }

  async _request(path, { method = "GET", query, body } = {}) {
    if (this.publicKeyMode && method !== "GET") {
      throw new Error("MyMap: public keys are read-only — use a secret key for writes");
    }
    const url = new URL(`${this.baseUrl}/api/v1${path}`, this.baseUrl || window.location.origin);
    if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new MyMapError(res.status, json);
    return json.data !== undefined ? json.data : json;
  }

  /* ------------------------------- maps ------------------------------- */

  /** GET /api/v1/maps — the map(s) this key can access. */
  listMaps() {
    return this._request("/maps");
  }

  /** GET /api/v1/maps/{mapId} */
  getMap(mapId) {
    return this._request(`/maps/${mapId}`);
  }

  /** GET /api/v1/maps/{mapId}/coverage — coverage tiers. */
  getCoverage(mapId) {
    return this._request(`/maps/${mapId}/coverage`);
  }

  /* ----------------------------- buildings ----------------------------- */

  /** GET /api/v1/maps/{mapId}/buildings */
  listBuildings(mapId) {
    return this._request(`/maps/${mapId}/buildings`);
  }

  /** GET /api/v1/buildings/{buildingId} */
  getBuilding(buildingId) {
    return this._request(`/buildings/${buildingId}`);
  }

  /* ----------------------------- locations ----------------------------- */

  /** GET /api/v1/maps/{mapId}/locations (generic map objects). */
  listLocations(mapId, { type, status } = {}) {
    return this._request(`/maps/${mapId}/locations`, { query: { type, status } });
  }

  /** GET /api/v1/locations/{locationId} */
  getLocation(locationId) {
    return this._request(`/locations/${locationId}`);
  }

  /* ------------------------------- models ------------------------------ */

  /** GET /api/v1/maps/{mapId}/models — 3D reconstruction versions. */
  listModels(mapId) {
    return this._request(`/maps/${mapId}/models`);
  }

  /** GET /api/v1/models/{modelId} */
  getModel(modelId) {
    return this._request(`/models/${modelId}`);
  }
}

/**
 * Embed helper — mounts the hosted map into a container div.
 * Equivalent to the iframe embed, but programmatic.
 *
 *   mountMap({ container: "#map", projectId: "map_…", baseUrl: "https://YOURDOMAIN", height: 600 })
 */
export function mountMap({ container, projectId, baseUrl = "", height = 600 }) {
  const el = typeof container === "string" ? document.querySelector(container) : container;
  if (!el) throw new Error("mountMap: container not found");
  const iframe = document.createElement("iframe");
  iframe.src = `${baseUrl.replace(/\/+$/, "")}/embed/${projectId}`;
  iframe.style.width = "100%";
  iframe.style.height = typeof height === "number" ? `${height}px` : height;
  iframe.style.border = "0";
  iframe.allowFullscreen = true;
  iframe.loading = "lazy";
  el.appendChild(iframe);
  return iframe;
}
