import Link from "next/link";
import { Note, Panel } from "@/components/portal-ui";

/**
 * The review-mode checkout surface.
 *
 * Mock mode used to point invoices at the gateway's own hosted checkout
 * (`checkout.pay2crypto.com/?txid=mock-…`). The gateway had no such payment,
 * so it answered "Payment link not found" — a third-party error page that
 * looked like a merchant fault on a rail that had never charged anybody.
 *
 * The mock rail now stays on our own origin and says what it is. Nothing here
 * collects money: an administrator settles the invoice from the console.
 */
export const metadata = {
  title: "Test checkout — Aglotrends",
};

type Params = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function MockCheckoutPage({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const amount = first(sp.amount);
  const asset = first(sp.asset) || "USDT";
  const network = first(sp.network) || "trc20";
  const purpose = first(sp.purpose) === "DEPOSIT" ? "Wallet deposit" : "Registration fee";
  const ref = first(sp.ref);
  const txid = first(sp.test_txid);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="mb-5 rounded-3xl border border-amber-400/40 bg-amber-400/10 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
          Test mode — no payment will be collected
        </p>
        <p className="mt-2 text-sm text-soft">
          This rail is a review rail, not a live one. It is not connected to
          Pay2Crypto: no wallet address is shown, no transaction is requested,
          and no funds can move. An administrator settles the invoice from the
          admin console once the flow has been reviewed.
        </p>
      </div>

      <Panel title="Test invoice">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-mist">Invoice</dt>
            <dd className="mt-1 text-soft">{purpose}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-mist">Amount</dt>
            <dd className="mt-1 font-bold text-soft">
              {amount ? `$${amount} ${asset}` : `— ${asset}`}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-mist">Rail</dt>
            <dd className="mt-1 text-soft uppercase">{network}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.12em] text-mist">Reference</dt>
            <dd className="mt-1 font-mono text-xs text-soft">{ref || "—"}</dd>
          </div>
          {txid && (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-[0.12em] text-mist">
                Test transaction id
              </dt>
              <dd className="mt-1 break-all font-mono text-xs text-mist">{txid}</dd>
            </div>
          )}
        </dl>
      </Panel>

      <div className="mt-4">
        <Note tone="warn">
          If you were expecting a live crypto payment here, the rail is not
          live yet — the server environment still has no Pay2Crypto credentials.
        </Note>
      </div>

      <div className="mt-5">
        <Link
          href="/wallet"
          className="text-sm font-bold text-brand-2 underline"
        >
          Back to your wallet
        </Link>
      </div>
    </div>
  );
}
