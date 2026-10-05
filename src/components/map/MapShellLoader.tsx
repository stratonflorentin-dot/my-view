"use client";

import dynamic from "next/dynamic";

const MapPageShell = dynamic(
  () => import("./MapPageShell").then((m) => m.MapPageShell),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-dvh items-center justify-center bg-[var(--bg)]">
        <p className="text-sm text-[var(--muted)]">Loading map…</p>
      </div>
    ),
  },
);

export default function MapShellLoader({
  visibility,
  initialBuildingId,
}: {
  visibility: "public" | "invite_only" | "private";
  initialBuildingId?: string | null;
}) {
  return (
    <MapPageShell visibility={visibility} initialBuildingId={initialBuildingId} />
  );
}
