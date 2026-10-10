import { Fragment } from "react";
import Link from "next/link";
import {
  ArrowUpRightIcon,
  BrokerIcon,
  CheckIcon,
  CommunityIcon,
  NetworkIcon,
  ShieldIcon,
  SignalIcon,
  XIcon,
} from "@/components/icons";
import { DEFAULT_SITE_CONTENT, mergeSiteContent, type SiteContent } from "@/lib/site-content";

// Marketing copy is console-editable, so revalidate rather than freeze at build.
export const revalidate = 60;

/**
 * Load the operator's content overrides. Any failure — API down, bad JSON,
 * slow response — degrades to the built-in defaults rather than breaking the
 * public landing page. This is the one page that must never 500.
 */
async function loadSiteContent(): Promise<SiteContent> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const res = await fetch(`${base}/api/content`, { next: { revalidate: 60 } });
    if (!res.ok) return DEFAULT_SITE_CONTENT;
    const data = (await res.json()) as { content?: unknown };
    return mergeSiteContent(data.content);
  } catch {
    return DEFAULT_SITE_CONTENT;
  }
}

/** Pillar icons are positional — the copy is editable, the iconography is not. */
const PILLAR_ICONS = [BrokerIcon, SignalIcon, NetworkIcon, CommunityIcon];

/* Compliance-locked sections. These are NOT editable from the console: risk
 * and custody disclosures must not be removable by a marketing edit. */
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

const custody = [
  ["Funds stay with your broker", "You fund and withdraw through your own approved broker account, not through Aglotrends."],
  ["Activity stays visible", "Monitor followed trades through your broker's platform or MetaTrader 5."],
  ["You control the connection", "Follow, pause, or disconnect on your own terms, at any time."],
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
  { Icon: ShieldIcon, label: "Auditable ledger" },
  { Icon: BrokerIcon, label: "Partner-broker custody" },
  { Icon: NetworkIcon, label: "Transparent network" },
  { Icon: SignalIcon, label: "Multi-channel delivery" },
];

export default async function LandingPage() {
  const content = await loadSiteContent();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      {/* HERO */}
      <section className="pt-12 sm:pt-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gold-2 backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          {content.hero.badge}
        </span>
        <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight text-soft sm:text-6xl">
          {content.hero.title.split("\n").map((line, i) => (
            <Fragment key={i}>
              {i > 0 && <br className="hidden sm:block" />}
              {line}
            </Fragment>
          ))}
        </h1>
        <p className="mt-5 max-w-2xl text-base text-mist sm:text-lg">{content.hero.subtitle}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-6 py-3 font-bold text-night transition hover:brightness-110"
          >
            Create your account
            <ArrowUpRightIcon className="h-4 w-4" />
          </Link>
          <Link
            href="#how-it-works"
            className="glass-soft inline-flex items-center justify-center rounded-2xl px-6 py-3 font-bold text-soft transition hover:border-gold/30 hover:text-gold-2"
          >
            See how it works
          </Link>
        </div>
        <p className="mt-4 max-w-xl text-xs text-muted">{content.hero.riskNote}</p>

        <dl className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {content.stats.map((s) => (
            <div key={s.label} className="glass rounded-2xl px-4 py-6">
              <dt className="text-gold-gradient text-3xl font-extrabold tracking-tight">{s.value}</dt>
              <dd className="mt-1 text-xs font-medium text-mist">{s.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* PILLARS */}
      <section id="pillars" className="pt-16 sm:pt-24">
        <SectionHeading
          eyebrow="One platform"
          title="Four tools that used to live in four places."
          sub="Copy trading, a signal service, a referral network, and a trader community — wired to the same account, the same wallet, and the same ledger."
        />
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {content.pillars.map((p, i) => {
            const Icon = PILLAR_ICONS[i] ?? ShieldIcon;
            return (
              <div key={p.title} className="glass group rounded-3xl p-6 transition hover:border-gold/30">
                <div className="flex items-start justify-between gap-4">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl border border-gold/20 bg-gold/5 text-gold-2 backdrop-blur-md">
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold text-mist backdrop-blur-md">
                    {p.tag}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold">{p.title}</h3>
                <p className="mt-2 text-sm text-mist">{p.body}</p>
              </div>
            );
          })}
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
          {content.steps.map((step, i) => (
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
              {custody.map(([t, b]) => (
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
              <span className="text-gold-gradient text-3xl font-extrabold tracking-tight">{step.n}</span>
              <h3 className="mt-4 font-bold">{step.title}</h3>
              <p className="mt-1.5 text-sm text-mist">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TRUST STRIP */}
      <section className="pt-16 sm:pt-24">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {trust.map(({ Icon, label }) => (
            <div key={label} className="glass flex items-center gap-3 rounded-2xl px-4 py-5">
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
          {content.faqs.map(({ q, a }) => (
            <details key={q} className="glass group rounded-2xl px-5 py-4 open:border-gold/30">
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
              {content.finalCta.title}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-mist sm:text-base">
              {content.finalCta.body}
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
            <p className="mx-auto mt-5 max-w-xl text-xs text-muted">{content.finalCta.note}</p>
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
