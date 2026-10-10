/**
 * Landing-page content model.
 *
 * The DEFAULTS live here, in the renderer — not in the API. The API is a
 * validated JSON store of operator overrides; this module owns the shape and
 * the fallback. That means the page renders correctly even when the API is
 * unreachable, and the copy exists in exactly one place.
 *
 * Compliance-critical sections (what Aglotrends is not, custody, risk
 * disclosures, the footer) are deliberately NOT part of this model. They are
 * locked in code so a marketing edit can never quietly remove them.
 */

export interface SiteContent {
  hero: {
    badge: string;
    /** May contain newlines — each line renders on its own line. */
    title: string;
    subtitle: string;
    riskNote: string;
  };
  stats: Array<{ value: string; label: string }>;
  pillars: Array<{ tag: string; title: string; body: string }>;
  steps: Array<{ title: string; body: string }>;
  faqs: Array<{ q: string; a: string }>;
  finalCta: { title: string; body: string; note: string };
}

export const DEFAULT_SITE_CONTENT: SiteContent = {
  hero: {
    badge: "Platform live · registration open",
    title: "Trade with structure.\nGrow with a network.",
    subtitle:
      "Aglotrends connects your own broker account to professional traders, delivers signals the moment they go live, and runs a referral network on a compensation engine you can actually audit.",
    riskNote: "Trading involves substantial risk. No return or income is guaranteed.",
  },
  stats: [
    { value: "4", label: "Integrated pillars" },
    { value: "3", label: "Signal channels" },
    { value: "24/5", label: "Market coverage" },
    { value: "$0", label: "Client capital held by us" },
  ],
  pillars: [
    {
      tag: "You keep control",
      title: "Copy Trading",
      body: "Follow proven traders from your own partner-broker account. Orders are placed on your broker — Aglotrends never holds your capital.",
    },
    {
      tag: "3 delivery channels",
      title: "Signal Service",
      body: "Professional trade ideas land on your dashboard the moment they are published — and reach you by email, WhatsApp, or Telegram.",
    },
    {
      tag: "Auditable by design",
      title: "Referral Network",
      body: "A transparent, auditable compensation engine — direct referrals, generation bonuses, a forced 3×3 matrix, and rank pools. Every payout is logged.",
    },
    {
      tag: "Learn the craft",
      title: "Trader Community",
      body: "Discover strategies and the traders behind them. Learn the craft alongside a network that grows as you do.",
    },
  ],
  steps: [
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
  ],
  faqs: [
    {
      q: "How does Aglotrends handle my trading capital?",
      a: "Aglotrends is not a broker and never holds your trading capital. You open and fund your own account with an approved partner broker; Aglotrends supplies the strategy, software, and community layer.",
    },
    {
      q: "Is any return or income guaranteed?",
      a: "No. Trading involves substantial risk and you can lose money. No return, rank, reward, or income is guaranteed — every figure shown is illustrative, not a promise.",
    },
    {
      q: "What do I get for the membership fee?",
      a: "Access to the platform: copy-trading oversight, the signal service, the referral program, and the member portal. The fee is a one-time membership fee — it is not a deposit and is not invested on your behalf.",
    },
    {
      q: "How are signals delivered?",
      a: "Published signals appear on your dashboard immediately and can also be delivered by email, WhatsApp, or Telegram, depending on the channels you enable in your settings.",
    },
    {
      q: "How are rewards paid?",
      a: "Rewards are computed in integer cents by the compensation engine and written to an auditable ledger. Payouts are requested from your wallet and settled by the Aglotrends team.",
    },
    {
      q: "What happens to my data?",
      a: "We collect only what is needed to operate your account and meet our obligations. You can review and update your notification preferences at any time from your portal.",
    },
  ],
  finalCta: {
    title: "Take the next informed step.",
    body: "Review how Aglotrends works, understand the risks, and complete each onboarding step at your own pace.",
    note: "Only commit funds you can afford to place at risk.",
  },
};

/* ------------------------------------------------------------------ merge */

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asArray<T>(
  value: unknown,
  fallback: T[],
  map: (item: Record<string, unknown>, index: number) => T,
): T[] {
  if (!Array.isArray(value) || value.length === 0) return fallback;
  const mapped = value
    .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    .map(map);
  return mapped.length > 0 ? mapped : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Fold stored overrides over the defaults. Every field is validated on the way
 * in, so a malformed or partially-saved blob degrades to the default for that
 * field rather than rendering `undefined`.
 */
export function mergeSiteContent(partial: unknown): SiteContent {
  const p = asRecord(partial);
  const hero = asRecord(p.hero);
  const finalCta = asRecord(p.finalCta);
  const d = DEFAULT_SITE_CONTENT;

  return {
    hero: {
      badge: asString(hero.badge, d.hero.badge),
      title: asString(hero.title, d.hero.title),
      subtitle: asString(hero.subtitle, d.hero.subtitle),
      riskNote: asString(hero.riskNote, d.hero.riskNote),
    },
    stats: asArray(p.stats, d.stats, (s) => ({
      value: asString(s.value, "—"),
      label: asString(s.label, "—"),
    })),
    pillars: asArray(p.pillars, d.pillars, (s, i) => ({
      tag: asString(s.tag, d.pillars[i]?.tag ?? ""),
      title: asString(s.title, d.pillars[i]?.title ?? ""),
      body: asString(s.body, d.pillars[i]?.body ?? ""),
    })),
    steps: asArray(p.steps, d.steps, (s, i) => ({
      title: asString(s.title, d.steps[i]?.title ?? ""),
      body: asString(s.body, d.steps[i]?.body ?? ""),
    })),
    faqs: asArray(p.faqs, d.faqs, (s) => ({
      q: asString(s.q, "Question"),
      a: asString(s.a, ""),
    })),
    finalCta: {
      title: asString(finalCta.title, d.finalCta.title),
      body: asString(finalCta.body, d.finalCta.body),
      note: asString(finalCta.note, d.finalCta.note),
    },
  };
}
