"use client";

import dynamic from "next/dynamic";

const ContributeFlow = dynamic(() => import("./ContributeFlow"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--bg)]">
      <p className="text-sm text-[var(--muted)]">Opening mapping session…</p>
    </div>
  ),
});

export default function ContributeLoader({ token }: { token: string }) {
  return <ContributeFlow token={token} />;
}
