"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(j.error ?? "Registration failed");
      setBusy(false);
      return;
    }
    router.push("/map");
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--bg)] p-5">
      <div className="mwm-panel w-full max-w-sm p-5">
        <Link href="/" className="font-display text-[15px] font-semibold">
          <span className="text-[var(--accent)]">▰</span> MyWorld 3D Map
        </Link>
        <h1 className="mt-4 font-display text-xl font-semibold">Create a viewer account</h1>
        <p className="mt-1 text-[12.5px] text-[var(--muted)]">
          Viewer accounts can explore the map when it is not private.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            className="mwm-input"
            required
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
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
            minLength={8}
            placeholder="Password (8+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-[12px] text-[var(--bad)]">{error}</p>}
          <button className="mwm-primary w-full" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Register"}
          </button>
        </form>
        <p className="mt-4 text-center text-[12px] text-[var(--muted)]">
          Already registered?{" "}
          <Link href="/login" className="text-[var(--accent)]">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
