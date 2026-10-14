"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, forgotPassword } from "@/lib/api";
import { ActionButton, Field, Note } from "@/components/portal-ui";

/** Forgot-password form. Shows the same note whether the address exists or not. */
export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Note>
          If an account exists for that address, a reset link is on its way. It expires in one
          hour and works once — check your inbox (and spam folder).
        </Note>
        <p className="text-center text-sm text-mist">
          <Link href="/login" className="font-bold text-brand-2 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-mist">
        Enter the email you registered with and we&apos;ll send you a password-reset link.
      </p>
      <Field
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="you@example.com"
        autoComplete="email"
        required
      />
      {error && <Note tone="error">{error}</Note>}
      <ActionButton type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send reset link"}
      </ActionButton>
      <p className="text-center text-sm text-mist">
        <Link href="/login" className="font-bold text-brand-2 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
