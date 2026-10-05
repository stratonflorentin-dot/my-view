"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/map";
  const oauthError = params.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(oauthError);
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
        <div className="mt-3 flex items-center gap-2">
          <span className="h-px flex-1 bg-[var(--border)]" />
          <span className="text-[11px] text-[var(--muted)]">or</span>
          <span className="h-px flex-1 bg-[var(--border)]" />
        </div>
        <a
          className="mwm-input mt-3 flex w-full items-center justify-center gap-2 !bg-white text-[13px] font-medium text-[#1f1f1f]"
          href={`/api/auth/google?next=${encodeURIComponent(next)}`}
        >
          <GoogleG />
          Continue with Google
        </a>
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

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.7 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.4 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6C44 38.1 46.5 31.9 46.5 24.5z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.6l-7.7-6c-2.1 1.4-4.8 2.3-7.5 2.3-6.3 0-11.6-3.9-13.5-9.3l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
