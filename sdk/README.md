# @mymap/sdk — JavaScript client for the Map API

A real, fetch-based SDK over the platform's `/api/v1` endpoints. No mocks:
every call performs an authenticated request against the live database.

## Install

The SDK ships with the platform (`sdk/mymap.js`, zero dependencies, ESM).
Copy it into your app, serve it from `/sdk/mymap.js`, or publish it to npm
as `@yourplatform/maps`.

```html
<script type="module">
  import { MyMap, mountMap } from "https://YOURDOMAIN/sdk/mymap.js";
</script>
```

## Usage

### Server-side (secret key)

```javascript
import { MyMap } from "./mymap.js";

const mymap = new MyMap({
  apiKey: process.env.MYMAP_SECRET_KEY, // mk_secret_…
  baseUrl: "https://YOURDOMAIN",
});

const maps = await mymap.listMaps();
const map = maps[0];

const buildings = await mymap.listBuildings(map.id);
for (const b of buildings) {
  console.log(b.name, b.verification, b.reconstruction?.confidence);
}

const landmarks = await mymap.listLocations(map.id, { type: "landmark" });
const models = await mymap.listModels(map.id);
```

### Browser (public key — read-only, origin-restricted)

```javascript
import { MyMap, mountMap } from "./mymap.js";

const mymap = new MyMap({ apiKey: "mk_public_…", baseUrl: "https://YOURDOMAIN" });
const map = await mymap.getMap("map_…");
console.log(map.center, map.defaultZoom);

// Or simply embed the hosted map:
mountMap({ container: "#map", projectId: "map_…", baseUrl: "https://YOURDOMAIN", height: 600 });
```

## Error handling

```javascript
import { MyMap, MyMapError } from "./mymap.js";
try {
  await mymap.getMap("forbidden-map-id");
} catch (e) {
  if (e instanceof MyMapError && e.status === 403) {
    // key not scoped to that project
  }
}
```

## Method → endpoint map

| SDK method | Endpoint |
|---|---|
| `listMaps()` | `GET /api/v1/maps` |
| `getMap(id)` | `GET /api/v1/maps/{mapId}` |
| `getCoverage(id)` | `GET /api/v1/maps/{mapId}/coverage` |
| `listBuildings(id)` | `GET /api/v1/maps/{mapId}/buildings` |
| `getBuilding(id)` | `GET /api/v1/buildings/{buildingId}` |
| `listLocations(id, opts)` | `GET /api/v1/maps/{mapId}/locations` |
| `getLocation(id)` | `GET /api/v1/locations/{locationId}` |
| `listModels(id)` | `GET /api/v1/maps/{mapId}/models` |
| `getModel(id)` | `GET /api/v1/models/{modelId}` |
| `mountMap(opts)` | iframe embed of `/embed/{projectId}` |
