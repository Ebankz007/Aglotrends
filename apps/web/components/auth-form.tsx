"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, login, register } from "@/lib/api";
import { ActionButton, Field, Note } from "@/components/portal-ui";

type Mode = "login" | "register";

/** Shared login/register form. On success the session cookie is set by the API. */
export function AuthForm({
  mode,
  sponsorEmail: initialSponsor,
  notice,
}: {
  mode: Mode;
  sponsorEmail?: string;
  notice?: string;
}) {
  const router = useRouter();
  const isLogin = mode === "login";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [sponsorEmail, setSponsorEmail] = useState(initialSponsor ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isLogin) {
        await login(email, password);
        router.push("/dashboard");
      } else {
        await register({
          email,
          password,
          fullName: fullName.trim(),
          sponsorEmail: sponsorEmail.trim() || undefined,
        });
        // Registration does not activate the account — the §1 fee does. Send the
        // new member straight to the wallet, where they settle it.
        router.push("/wallet");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {notice && <Note>{notice}</Note>}
      {!isLogin && (
        <Field
          label="Full name"
          value={fullName}
          onChange={setFullName}
          placeholder="Jane Doe"
          autoComplete="name"
          required
        />
      )}
      <Field
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
        autoComplete="email"
        required
      />
      <Field
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        placeholder="At least 8 characters"
        autoComplete={isLogin ? "current-password" : "new-password"}
        required
      />
      {!isLogin && (
        <Field
          label="Sponsor email (optional)"
          type="email"
          value={sponsorEmail}
          onChange={setSponsorEmail}
          placeholder="your.sponsor@example.com"
          autoComplete="off"
        />
      )}

      {error && <Note tone="error">{error}</Note>}

      <ActionButton type="submit" disabled={busy}>
        {busy ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
      </ActionButton>

      <p className="text-center text-sm text-mist">
        {isLogin ? (
          <>
            No account yet?{" "}
            <Link href="/register" className="font-bold text-brand-2 hover:underline">
              Register
            </Link>
          </>
        ) : (
          <>
            Already registered?{" "}
            <Link href="/login" className="font-bold text-brand-2 hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
