"use client";

import { useState } from "react";
import {
  ActionButton,
  Badge,
  Empty,
  Field,
  Note,
  Panel,
  PortalPage,
  Stat,
  Table,
  Td,
  Tr,
} from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  createDeposit,
  createRegistrationPayment,
  fetchLedger,
  fetchMe,
  fetchMyKyc,
  fetchMyPayments,
  fetchMyPayouts,
  fetchWallet,
  refreshCheckout,
  requestPayout,
  type PaymentDto,
} from "@/lib/api";
import { formatCents, formatDateTime } from "@/lib/format";
import { KycPanel } from "@/components/kyc-panel";

function payoutTone(status: string): "neutral" | "ok" | "warn" | "danger" | "info" {
  switch (status) {
    case "PAID":
      return "ok";
    case "APPROVED":
      return "info";
    case "REJECTED":
      return "danger";
    default:
      return "warn";
  }
}

function paymentTone(status: string): "neutral" | "ok" | "warn" | "danger" | "info" {
  switch (status) {
    case "PAID":
      return "ok";
    case "PENDING":
      return "warn";
    case "FAILED":
      return "danger";
    default:
      return "neutral";
  }
}

/** A link styled as the primary action button (checkout must be a real link,
 *  not a JS window.open — popup blockers eat the latter). */
function CheckoutLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-sm font-bold text-night transition hover:brightness-110 active:scale-[0.99]"
    >
      {children}
    </a>
  );
}

export function WalletCenter() {
  const { data, error, loading, reload } = useAsync(async () => {
    const [me, balanceCents, entries, payouts, payments, kyc] = await Promise.all([
      fetchMe(),
      fetchWallet(),
      fetchLedger(),
      fetchMyPayouts(),
      fetchMyPayments(),
      fetchMyKyc(),
    ]);
    return { me, balanceCents, entries, payouts, payments, kyc };
  });

  const [checkout, setCheckout] = useState<PaymentDto | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const [depositAmount, setDepositAmount] = useState("");
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositBusy, setDepositBusy] = useState(false);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const isActive = data?.me?.isActiveMember ?? true;
  const kycStatus = data?.kyc?.status ?? "NOT_STARTED";
  const kycVerified = kycStatus === "VERIFIED";

  /** Create the §1 registration invoice and surface the checkout link. */
  async function onPayRegistration() {
    setPayError(null);
    setPayBusy(true);
    try {
      const payment = await createRegistrationPayment();
      setCheckout(payment);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === "ALREADY_REGISTERED") {
        setPayError("Your registration fee is already settled.");
        reload();
      } else {
        setPayError(err instanceof ApiError ? err.message : "Could not start the payment.");
      }
    } finally {
      setPayBusy(false);
    }
  }

  async function onDeposit(e: React.FormEvent) {
    e.preventDefault();
    setDepositError(null);
    const dollars = Number(depositAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setDepositError("Enter a valid amount.");
      return;
    }
    setDepositBusy(true);
    try {
      const payment = await createDeposit(Math.round(dollars * 100));
      setCheckout(payment);
      setDepositAmount("");
      reload();
    } catch (err) {
      setDepositError(err instanceof ApiError ? err.message : "Could not start the deposit.");
    } finally {
      setDepositBusy(false);
    }
  }

  /** The gateway link expires; ask for a fresh one before sending the member out. */
  async function onOpenCheckout(payment: PaymentDto) {
    setPayError(null);
    try {
      const fresh = await refreshCheckout(payment.id);
      setCheckout({ ...payment, paymentUrl: fresh.paymentUrl });
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : "Could not refresh the checkout link.");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOk(null);
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setFormError("Enter a valid amount.");
      return;
    }
    setBusy(true);
    try {
      await requestPayout({
        amountCents: Math.round(dollars * 100),
        method: method.trim() || undefined,
        details: details.trim() || undefined,
      });
      setOk("Payout requested. An administrator will review it.");
      setAmount("");
      setMethod("");
      setDetails("");
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not submit the request.");
    } finally {
      setBusy(false);
    }
  }

  const pendingRegistration = data?.payments.find(
    (p) => p.purpose === "REGISTRATION" && p.status === "PENDING",
  );

  return (
    <PortalPage title="Wallet">
      {error && <Note tone="error">{error}</Note>}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Available balance" value={loading ? "…" : formatCents(data?.balanceCents ?? 0)} />
        <Stat label="Ledger entries" value={loading ? "…" : (data?.entries.length ?? 0)} />
        <Stat
          label="Membership"
          value={loading ? "…" : isActive ? "Active" : "Not active"}
          hint={loading ? undefined : isActive ? undefined : "Registration fee unpaid"}
        />
      </section>

      {!loading && !isActive && (
        <Panel title="Activate your membership">
          <p className="text-sm text-mist">
            Your account is created, but membership is not active yet. Settle the one-time{" "}
            <span className="font-bold text-soft">$20.00</span> registration fee to take your seat in
            the matrix and become eligible for referral and generation bonuses.
          </p>
          {payError && (
            <div className="mt-3">
              <Note tone="error">{payError}</Note>
            </div>
          )}
          <div className="mt-4">
            <ActionButton onClick={onPayRegistration} disabled={payBusy}>
              {payBusy ? "Preparing checkout…" : "Pay $20.00 registration fee"}
            </ActionButton>
          </div>
          <p className="mt-3 text-xs text-mist">
            Payment is in USDT (TRC20) via Pay2Crypto. Your account activates automatically once the
            network confirms it.
          </p>
        </Panel>
      )}

      {checkout?.paymentUrl && (
        <Panel title="Complete your payment">
          <p className="text-sm text-mist">
            {checkout.purpose === "REGISTRATION" ? "Registration fee" : "Deposit"} of{" "}
            <span className="font-bold text-soft">{formatCents(checkout.amountCents)}</span> —
            reference <span className="font-mono text-xs">{checkout.paymentRef}</span>.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <CheckoutLink href={checkout.paymentUrl}>Open secure checkout</CheckoutLink>
            <ActionButton tone="quiet" onClick={() => onOpenCheckout(checkout)}>
              Link expired? Get a fresh one
            </ActionButton>
            <ActionButton tone="quiet" onClick={reload}>
              I&apos;ve paid — refresh status
            </ActionButton>
          </div>
          {payError && (
            <div className="mt-3">
              <Note tone="error">{payError}</Note>
            </div>
          )}
        </Panel>
      )}

      {!loading && !isActive && pendingRegistration && !checkout && (
        <Note>
          You have a pending registration invoice.{" "}
          <button
            type="button"
            onClick={() => onOpenCheckout(pendingRegistration)}
            className="font-bold text-brand-2 underline"
          >
            Resume payment
          </button>
        </Note>
      )}

      {!loading && data?.kyc && <KycPanel kyc={data.kyc} onSubmitted={reload} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Fund your wallet">
          <form onSubmit={onDeposit} className="flex flex-col gap-4">
            <Field
              label="Deposit amount (USD)"
              type="number"
              value={depositAmount}
              onChange={setDepositAmount}
              placeholder="100.00"
            />
            {depositError && <Note tone="error">{depositError}</Note>}
            <ActionButton type="submit" disabled={depositBusy}>
              {depositBusy ? "Preparing checkout…" : "Deposit with USDT"}
            </ActionButton>
            <p className="text-xs text-mist">
              Deposits are credited to your wallet once the network confirms the transfer.
            </p>
          </form>
        </Panel>

        <Panel title="Request a payout">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Field
              label="Amount (USD)"
              type="number"
              value={amount}
              onChange={setAmount}
              placeholder="100.00"
            />
            <Field label="Method (optional)" value={method} onChange={setMethod} placeholder="USDT TRC20" />
            <Field
              label="Payment details (optional)"
              value={details}
              onChange={setDetails}
              placeholder="Wallet address / account"
            />
            {formError && <Note tone="error">{formError}</Note>}
            {ok && <Note tone="ok">{ok}</Note>}
            {!kycVerified && (
              <Note tone="warn">
                {kycStatus === "PENDING"
                  ? "Your identity verification is under review — withdrawals unlock once it is approved."
                  : kycStatus === "REJECTED"
                    ? "Your identity verification was rejected. Resubmit it above to unlock withdrawals."
                    : "Complete identity verification above to unlock withdrawals."}
              </Note>
            )}
            <ActionButton type="submit" disabled={busy || !kycVerified}>
              {busy ? "Submitting…" : "Request payout"}
            </ActionButton>
            <p className="text-xs text-mist">
              Funds are held when you request a payout and released once an administrator approves it.
            </p>
          </form>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Payments">
          {loading ? (
            <Empty>Loading…</Empty>
          ) : data && data.payments.length > 0 ? (
            <Table columns={["Purpose", "Amount", "Status", "Created"]}>
              {data.payments.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-semibold">{p.purpose === "REGISTRATION" ? "Registration" : "Deposit"}</Td>
                  <Td>{formatCents(p.amountCents)}</Td>
                  <Td>
                    <Badge tone={paymentTone(p.status)}>{p.status}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(p.createdAt)}</Td>
                </Tr>
              ))}
            </Table>
          ) : (
            <Empty>No payments yet.</Empty>
          )}
        </Panel>

        <Panel title="Payout history">
          {loading ? (
            <Empty>Loading…</Empty>
          ) : data && data.payouts.length > 0 ? (
            <Table columns={["Amount", "Status", "Requested"]}>
              {data.payouts.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-semibold">{formatCents(p.amountCents)}</Td>
                  <Td>
                    <Badge tone={payoutTone(p.status)}>{p.status}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(p.createdAt)}</Td>
                </Tr>
              ))}
            </Table>
          ) : (
            <Empty>No payout requests yet.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="Ledger">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.entries.length > 0 ? (
          <Table columns={["Type", "Amount", "Balance after", "When"]}>
            {data.entries.map((e) => (
              <Tr key={e.id}>
                <Td>
                  <span className="font-semibold">{e.type}</span>
                  {e.description && <p className="mt-0.5 text-xs text-mist">{e.description}</p>}
                </Td>
                <Td className={e.amountCents < 0 ? "text-red-300" : "text-emerald-300"}>
                  {formatCents(e.amountCents)}
                </Td>
                <Td className="text-mist">{formatCents(e.balanceAfterCents)}</Td>
                <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(e.createdAt)}</Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No ledger activity yet.</Empty>
        )}
      </Panel>
    </PortalPage>
  );
}
