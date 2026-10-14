"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, resetPassword } from "@/lib/api";
import { ActionButton, Field, Note } from "@/components/portal-ui";

/** Redeem a reset link. The token arrives as ?token= and is never displayed. */
export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please request a new link.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <Note tone="error">
          This reset link is incomplete. Please request a new one from the sign-in page.
        </Note>
        <p className="text-center text-sm text-mist">
          <Link href="/forgot-password" className="font-bold text-brand-2 hover:underline">
            Request a new link
          </Link>
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Note tone="ok">Your password is set. Sign in with the new one.</Note>
        <ActionButton
          onClick={() => {
            router.push("/login");
            router.refresh();
          }}
        >
          Go to sign in
        </ActionButton>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field
        label="New password"
        type="password"
        value={password}
        onChange={setPassword}
        placeholder="At least 8 characters"
        autoComplete="new-password"
        required
      />
      <Field
        label="Confirm new password"
        type="password"
        value={confirm}
        onChange={setConfirm}
        placeholder="Repeat it"
        autoComplete="new-password"
        required
      />
      {error && <Note tone="error">{error}</Note>}
      <ActionButton type="submit" disabled={busy}>
        {busy ? "Saving…" : "Set new password"}
      </ActionButton>
    </form>
  );
}
