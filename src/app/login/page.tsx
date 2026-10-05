"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/map";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(j.error ?? "Sign-in failed");
      setBusy(false);
      return;
    }
    router.push(j.user?.role === "admin" ? next === "/map" ? "/admin" : next : next);
    router.refresh();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--bg)] p-5">
      <div className="mwm-panel w-full max-w-sm p-5">
        <Link href="/" className="font-display text-[15px] font-semibold">
          <span className="text-[var(--accent)]">▰</span> MyWorld 3D Map
        </Link>
        <h1 className="mt-4 font-display text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-[12.5px] text-[var(--muted)]">
          Access the map, dashboard and API.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            className="mwm-input"
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="mwm-input"
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-[12px] text-[var(--bad)]">{error}</p>}
          <button className="mwm-primary w-full" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 rounded-md bg-[var(--hover)] px-2 py-1.5 text-center text-[11px] text-[var(--muted)]">
          Demo admin: <span className="tabular">admin@myworld.local / admin1234</span>
        </p>
        <p className="mt-3 text-center text-[12px] text-[var(--muted)]">
          No account?{" "}
          <Link href="/register" className="text-[var(--accent)]">
            Register a viewer
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
