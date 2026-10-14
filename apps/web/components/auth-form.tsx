"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, login, register, verifyTwoFactor } from "@/lib/api";
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

  // Second step. Set once the password is accepted on a 2FA-enabled account —
  // at that point no session exists yet, only a short-lived challenge token.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!isLogin) {
        const ref = sponsorEmail.trim();
        if (!ref) {
          setError("A referrer is required — please use your sponsor's link or enter their email.");
          setBusy(false);
          return;
        }
        await register({
          email,
          password,
          fullName: fullName.trim(),
          sponsorEmail: ref,
        });
        // Registration does not activate the account — the §1 fee does. Send the
        // new member straight to the wallet, where they settle it.
        router.push("/wallet");
        router.refresh();
        return;
      }

      if (challengeToken) {
        await verifyTwoFactor(challengeToken, code);
        router.push("/dashboard");
        router.refresh();
        return;
      }

      const result = await login(email, password);
      if (result.twoFactorRequired) {
        setChallengeToken(result.challengeToken);
        setCode("");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (challengeToken) {
    return (
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Note>
          Two-factor authentication is enabled for{" "}
          <strong className="text-soft">{email}</strong>. Enter the 6-digit code from your
          authenticator app.
        </Note>
        <Field
          label="Authentication code"
          value={code}
          onChange={setCode}
          placeholder="123456"
          autoComplete="one-time-code"
          autoFocus
          required
          hint="Lost your device? Enter one of your recovery codes instead."
        />

        {error && <Note tone="error">{error}</Note>}

        <ActionButton type="submit" disabled={busy}>
          {busy ? "Verifying…" : "Verify and sign in"}
        </ActionButton>

        <button
          type="button"
          onClick={() => {
            setChallengeToken(null);
            setCode("");
            setError(null);
          }}
          className="text-center text-sm font-bold text-brand-2 hover:underline"
        >
          Use a different account
        </button>
      </form>
    );
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
          label="Referrer email (required)"
          type="email"
          value={sponsorEmail}
          onChange={setSponsorEmail}
          placeholder="your.sponsor@example.com"
          autoComplete="off"
          required
        />
      )}

      {error && <Note tone="error">{error}</Note>}

      <ActionButton type="submit" disabled={busy}>
        {busy ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
      </ActionButton>

      {isLogin && !challengeToken && (
        <p className="text-center text-sm text-mist">
          <Link href="/forgot-password" className="font-bold text-brand-2 hover:underline">
            Forgot your password?
          </Link>
        </p>
      )}

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
