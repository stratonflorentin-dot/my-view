"use client";

import dynamic from "next/dynamic";
import type { MapViewHandle } from "./MapView";

const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[var(--bg-2)]">
      <p className="text-sm text-[var(--muted)]">Loading live map…</p>
    </div>
  ),
});

export default function MapLoader({
  preview = false,
  ...rest
}: React.ComponentProps<typeof MapView>) {
  return <MapView ref={rest.ref as React.Ref<MapViewHandle>} preview={preview} {...rest} />;
}
