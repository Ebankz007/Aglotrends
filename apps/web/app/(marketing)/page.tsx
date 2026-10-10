import Link from "next/link";
import {
  ArrowUpRightIcon,
  BellIcon,
  BrokerIcon,
  CheckIcon,
  CommunityIcon,
  NetworkIcon,
  ShieldIcon,
  SignalIcon,
  WalletIcon,
  XIcon,
} from "@/components/icons";

const stats = [
  { value: "4", label: "Integrated pillars" },
  { value: "3", label: "Signal channels" },
  { value: "24/5", label: "Market coverage" },
  { value: "$0", label: "Client capital held by us" },
];

const pillars = [
  {
    Icon: BrokerIcon,
    title: "Copy Trading",
    body: "Follow proven traders from your own partner-broker account. Orders are placed on your broker — Aglotrends never holds your capital.",
    tag: "You keep control",
  },
  {
    Icon: SignalIcon,
    title: "Signal Service",
    body: "Professional trade ideas land on your dashboard the moment they are published — and reach you by email, WhatsApp, or Telegram.",
    tag: "3 delivery channels",
  },
  {
    Icon: NetworkIcon,
    title: "Referral Network",
    body: "A transparent, auditable compensation engine — direct referrals, generation bonuses, a forced 3×3 matrix, and rank pools. Every payout is logged.",
    tag: "Auditable by design",
  },
  {
    Icon: CommunityIcon,
    title: "Trader Community",
    body: "Discover strategies and the traders behind them. Learn the craft alongside a network that grows as you do.",
    tag: "Learn the craft",
  },
];

const steps = [
  {
    title: "Create your account",
    body: "Register through the official Aglotrends domain, complete onboarding, and activate your membership.",
  },
  {
    title: "Connect your broker",
    body: "Open an account directly with an approved partner broker and record the link here. Your funds stay with the broker.",
  },
  {
    title: "Follow traders & signals",
    body: "Mirror partner traders on your own broker account and receive signals across your dashboard and messaging channels.",
  },
  {
    title: "Grow your network",
    body: "Invite and support members under the published program. Track every referral and reward inside your member portal.",
  },
];

const paths = [
  {
    tag: "Path A",
    title: "Copy-trading & signals participant",
    body: "Open and fund an eligible personal broker account, review the risk disclosures, then follow partner traders and receive signals.",
    note: "Your trading capital stays in your broker account — never with Aglotrends.",
    points: [
      "Follow listed partner traders you choose",
      "Signals on dashboard, email, WhatsApp & Telegram",
      "Fund and withdraw directly through your broker",
    ],
  },
  {
    tag: "Path B",
    title: "Community partner",
    body: "Refer and support eligible members under the Aglotrends community program.",
    note: "Rewards depend on qualification and activity, and are never guaranteed.",
    points: [
      "Published terms, eligibility & reward examples",
      "Every referral and payout visible in your portal",
      "No reward is paid on a member's trading principal",
    ],
  },
];

const notList = [
  "Not a broker, bank, or deposit-taker.",
  "Not a custodian of your trading capital.",
  "Not a guaranteed-return or fixed-income program.",
  "Not a promise of rank, reward, or income.",
];

const pipeline = [
  {
    n: "01",
    title: "Signal engine",
    body: "Strategy authors publish trade ideas that flow straight to member dashboards and delivery channels.",
  },
  {
    n: "02",
    title: "Copy oversight",
    body: "Partner traders are listed with their strategy, market, and risk profile — you decide who to follow, and how much.",
  },
  {
    n: "03",
    title: "Compensation ledger",
    body: "Every referral, bonus, matrix placement, and pool payout is computed in integer cents and written to an auditable ledger.",
  },
];

const trust = [
  { Icon: ShieldIcon, label: "Encrypted sessions" },
  { Icon: WalletIcon, label: "Capital stays with your broker" },
  { Icon: BrokerIcon, label: "Approved partner brokers" },
  { Icon: BellIcon, label: "Support & alerts" },
];

const faqs = [
  {
    q: "Does Aglotrends hold my trading funds?",
    a: "No. Trading capital stays in your own account with an approved partner broker. Aglotrends provides the software, signals, and community layer — not custody of your funds.",
  },
  {
    q: "Is any trading return guaranteed?",
    a: "No. Trading losses are possible. Risk controls can help manage exposure, but they cannot guarantee a return or remove the risk of loss.",
  },
  {
    q: "How are signals delivered?",
    a: "Signals are published to your member dashboard and can also be delivered by email, WhatsApp, or Telegram the moment they go live.",
  },
  {
    q: "Is the membership fee trading capital?",
    a: "No. The membership fee is a separate activation transaction. It is not a trading deposit and is never placed into markets on your behalf.",
  },
  {
    q: "How does the referral program work?",
    a: "It is a qualification-based community program with published terms, eligibility rules, and reward examples inside your member portal. Rewards are not investment returns and are never guaranteed.",
  },
  {
    q: "Can I pause or stop following a trader?",
    a: "Yes. Following is under your control — you choose what to follow and can stop at any time. Open positions remain subject to your broker's terms.",
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
      {/* HERO */}
      <section className="py-14 text-center sm:py-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/5 px-3 py-1 text-xs font-bold text-gold-2 backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          Platform live · registration open
        </span>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-6xl">
          Trade with structure.
          <br className="hidden sm:block" /> Grow with a network.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-mist sm:text-lg">
          Aglotrends connects your own broker account to professional traders, delivers signals the
          moment they go live, and runs a referral network on a compensation engine you can actually
          audit.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/register"
            className="w-full rounded-2xl bg-brand px-6 py-3 text-center font-bold text-night transition hover:brightness-110 sm:w-auto"
          >
            Create your account
          </Link>
          <Link
            href="#how-it-works"
            className="glass-soft w-full rounded-2xl px-6 py-3 text-center font-bold text-soft transition hover:border-gold/30 hover:text-gold-2 sm:w-auto"
          >
            See how it works
          </Link>
        </div>
        <p className="mx-auto mt-4 max-w-xl text-xs text-muted">
          Trading involves substantial risk. No return or income is guaranteed.
        </p>

        <dl className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="glass rounded-2xl px-4 py-6">
              <dt className="text-gold-gradient text-3xl font-extrabold tracking-tight">{s.value}</dt>
              <dd className="mt-1 text-xs font-medium text-mist">{s.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* PILLARS */}
      <section id="pillars" className="pt-6">
        <SectionHeading
          eyebrow="One platform"
          title="Four tools that used to live in four places."
          sub="Copy trading, a signal service, a referral network, and a trader community — wired to the same account, the same wallet, and the same ledger."
        />
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {pillars.map(({ Icon, title, body, tag }) => (
            <div
              key={title}
              className="glass group rounded-3xl p-6 transition hover:border-gold/30"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="grid h-12 w-12 place-items-center rounded-2xl border border-gold/20 bg-gold/5 text-gold-2 backdrop-blur-md">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold text-mist backdrop-blur-md">
                  {tag}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold">{title}</h3>
              <p className="mt-2 text-sm text-mist">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="pt-16 sm:pt-24">
        <SectionHeading
          eyebrow="How it works"
          title="A clear path from account to control."
          sub="Four steps. Each one you complete on your own terms, with your capital held by your broker — not by us."
        />
        <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <li key={step.title} className="glass rounded-3xl p-6">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-gold-2 to-gold-deep font-bold text-night">
                {i + 1}
              </span>
              <h3 className="mt-4 font-bold">{step.title}</h3>
              <p className="mt-1.5 text-sm text-mist">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* TWO PATHS */}
      <section id="paths" className="pt-16 sm:pt-24">
        <SectionHeading
          eyebrow="Two distinct paths"
          title="Trading and community are separate."
          sub="Choose the part of the ecosystem that fits your goals. Each path has its own rules, risks, and responsibilities."
        />
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {paths.map((p) => (
            <div key={p.tag} className="glass flex flex-col rounded-3xl p-6 sm:p-8">
              <span className="w-fit rounded-full border border-gold/25 bg-gold/5 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-gold-2 backdrop-blur-md">
                {p.tag}
              </span>
              <h3 className="mt-4 text-xl font-bold">{p.title}</h3>
              <p className="mt-2 text-sm text-mist">{p.body}</p>
              <ul className="mt-5 space-y-2.5">
                {p.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2.5 text-sm text-soft">
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 border-t border-white/10 pt-4 text-xs text-muted">{p.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CUSTODY / WHAT WE ARE NOT */}
      <section id="custody" className="pt-16 sm:pt-24">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="glass rounded-3xl p-6 sm:p-8">
            <h2 className="text-2xl font-bold">Your capital stays separate.</h2>
            <p className="mt-3 text-sm text-mist">
              Aglotrends supplies the strategy, software, and community layer. Your personal broker
              holds your trading account and your funds.
            </p>
            <ul className="mt-6 space-y-4">
              {[
                ["Funds stay with your broker", "You fund and withdraw through your own approved broker account, not through Aglotrends."],
                ["Activity stays visible", "Monitor followed trades through your broker's platform or MetaTrader 5."],
                ["You control the connection", "Follow, pause, or disconnect on your own terms, at any time."],
              ].map(([t, b]) => (
                <li key={t} className="flex gap-3">
                  <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                  <div>
                    <p className="text-sm font-bold">{t}</p>
                    <p className="mt-0.5 text-sm text-mist">{b}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="glass-soft rounded-3xl p-6 sm:p-8">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
              What Aglotrends is not
            </span>
            <ul className="mt-5 space-y-3">
              {notList.map((n) => (
                <li key={n} className="flex items-start gap-3 text-sm text-soft">
                  <XIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 rounded-2xl border border-gold/20 bg-gold/5 p-4 backdrop-blur-md">
              <p className="text-xs text-mist">
                <span className="font-bold text-soft">Protect your access details.</span> Aglotrends
                will never ask for your email password, bank or card PIN, one-time password, crypto
                seed phrase, or remote access to your device. Only follow links on the official
                Aglotrends domain.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* PLATFORM / ENGINE */}
      <section id="platform" className="pt-16 sm:pt-24">
        <SectionHeading
          eyebrow="Under the hood"
          title="Intelligence is only useful when it passes through discipline."
          sub="Aglotrends runs a single pipeline: signals in, oversight on, and every reward written to a ledger you can inspect."
        />
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {pipeline.map((step) => (
            <div key={step.n} className="glass rounded-3xl p-6">
              <span className="text-gold-gradient text-3xl font-extrabold tracking-tight">
                {step.n}
              </span>
              <h3 className="mt-3 font-bold">{step.title}</h3>
              <p className="mt-1.5 text-sm text-mist">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TRUST STRIP */}
      <section className="pt-16 sm:pt-24">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {trust.map(({ Icon, label }) => (
            <div key={label} className="glass flex items-center gap-3 rounded-2xl px-5 py-6">
              <Icon className="h-5 w-5 shrink-0 text-gold" />
              <span className="text-sm font-semibold text-soft">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="pt-16 sm:pt-24">
        <SectionHeading
          eyebrow="FAQ"
          title="Clear answers. Honest unknowns."
          sub="The essentials about custody, risk, signals, and eligibility."
        />
        <div className="mt-8 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {faqs.map(({ q, a }) => (
            <details
              key={q}
              className="glass group rounded-2xl px-5 py-4 open:border-gold/30"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-soft [&::-webkit-details-marker]:hidden">
                {q}
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/15 text-gold-2 transition group-open:rotate-45">
                  <PlusGlyph />
                </span>
              </summary>
              <p className="mt-3 text-sm text-mist">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="pt-16 sm:pt-24">
        <div className="glass relative overflow-hidden rounded-3xl p-8 text-center sm:p-14">
          <div className="app-glow pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-2xl font-extrabold tracking-tight sm:text-4xl">
              Take the next informed step.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-mist sm:text-base">
              Review how Aglotrends works, understand the risks, and complete each onboarding step at
              your own pace.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/register"
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-6 py-3 font-bold text-night transition hover:brightness-110 sm:w-auto"
              >
                Create your account
                <ArrowUpRightIcon className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="glass-soft w-full rounded-2xl px-6 py-3 text-center font-bold text-soft transition hover:border-gold/30 hover:text-gold-2 sm:w-auto"
              >
                Sign in
              </Link>
            </div>
            <p className="mx-auto mt-5 max-w-xl text-xs text-muted">
              Only commit funds you can afford to place at risk.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function SectionHeading({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="max-w-2xl">
      <span className="text-[11px] font-bold uppercase tracking-wide text-gold-2">{eyebrow}</span>
      <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h2>
      <p className="mt-3 text-sm text-mist sm:text-base">{sub}</p>
    </div>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
