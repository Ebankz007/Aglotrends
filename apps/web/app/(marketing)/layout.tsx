import Link from "next/link";
import { CandleBackground } from "@/components/candle-background";
import { DEFAULT_SITE_CONTENT, mergeSiteContent, type SiteContent } from "@/lib/site-content";

// Footer copy and social links are console-editable, so revalidate rather than freeze.
export const revalidate = 60;

/** The public shape of a footer social link — a subset of the admin DTO. */
interface FooterSocialLink {
  id: string;
  platform: string;
  label: string;
  url: string;
  handle: string;
}

const navLinks = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#paths", label: "Community" },
  { href: "#platform", label: "Platform" },
  { href: "#faq", label: "FAQ" },
];

const footerNav = [
  {
    heading: "Platform",
    links: [
      { href: "#how-it-works", label: "How it works" },
      { href: "#pillars", label: "Four pillars" },
      { href: "#paths", label: "Two paths" },
      { href: "#faq", label: "FAQ" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "/register", label: "Create account" },
      { href: "/login", label: "Sign in" },
      { href: "/register", label: "Get started" },
      { href: "#custody", label: "Safety & control" },
    ],
  },
];

const legal = [
  { label: "Risk disclosure", href: "/risk-disclosure" },
  { label: "Terms of Service", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
];

/**
 * Load the operator's footer copy and social links. Any failure — API down, bad
 * JSON, slow response — degrades to the built-in defaults rather than breaking
 * the public site. The marketing surface must never 500.
 */
async function loadFooter(): Promise<{ content: SiteContent; social: FooterSocialLink[] }> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";
    const res = await fetch(`${base}/api/content`, { next: { revalidate: 60 } });
    if (!res.ok) return { content: DEFAULT_SITE_CONTENT, social: [] };
    const data = (await res.json()) as { content?: unknown; social?: unknown };
    // The API returns `social: { links: [...] }`, not a bare array.
    const raw = (data.social as { links?: unknown } | undefined)?.links;
    const social = Array.isArray(raw)
      ? (raw as FooterSocialLink[]).filter(
          (s) => s && typeof s.url === "string" && typeof s.id === "string",
        )
      : [];
    return { content: mergeSiteContent(data.content), social };
  } catch {
    return { content: DEFAULT_SITE_CONTENT, social: [] };
  }
}

export default async function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { content, social } = await loadFooter();
  const { contact, footer } = content;

  return (
    <div className="min-h-screen bg-night text-soft">
      <div className="app-glow pointer-events-none fixed inset-0" aria-hidden="true" />
      <CandleBackground />

      {/* Risk banner — compliance-locked, not console-editable. */}
      <div className="relative border-b border-white/10 bg-navy/50 backdrop-blur-sm">
        <p className="mx-auto max-w-6xl px-4 py-2 text-center text-[11px] text-mist sm:px-6">
          Trading and copy trading involve substantial risk and may result in loss. Returns and
          referral income are not guaranteed.
        </p>
      </div>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-night/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <img src="/logo-icon.svg" alt="Aglotrends" className="h-12 w-12" />
            Aglotrends
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-mist md:flex">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="transition hover:text-gold-2">
                {l.label}
              </a>
            ))}
          </nav>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              href="/login"
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2 font-bold text-soft backdrop-blur-md transition hover:bg-white/10"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-full bg-brand px-4 py-2 font-bold text-night transition hover:brightness-110"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <div className="relative">{children}</div>

      <footer className="relative mt-16 border-t border-white/10 bg-night-2/70 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div>
              <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <img src="/logo-icon.svg" alt="Aglotrends" className="h-12 w-12" />
                Aglotrends
              </Link>
              <p className="mt-4 max-w-xs text-sm text-mist">{footer.tagline}</p>
              <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-gold/20 bg-gold/5 px-3 py-1 text-[11px] font-bold text-gold-2">
                <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                {footer.badge}
              </p>

              {social.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-soft">Follow</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {social.map((s) => (
                      <a
                        key={s.id}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-mist transition hover:border-gold/30 hover:text-gold-2"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                        {s.handle || s.label}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {(contact.email || contact.phone || contact.address) && (
                <div className="mt-5">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-soft">Contact</h3>
                  <ul className="mt-3 space-y-1.5 text-sm text-mist">
                    {contact.email && (
                      <li>
                        <a href={`mailto:${contact.email}`} className="transition hover:text-gold-2">
                          {contact.email}
                        </a>
                      </li>
                    )}
                    {contact.phone && (
                      <li>
                        <a
                          href={`tel:${contact.phone.replace(/[^+0-9]/g, "")}`}
                          className="transition hover:text-gold-2"
                        >
                          {contact.phone}
                        </a>
                      </li>
                    )}
                    {contact.address && <li className="whitespace-pre-line">{contact.address}</li>}
                  </ul>
                </div>
              )}
            </div>

            {footerNav.map((col) => (
              <div key={col.heading}>
                <h3 className="text-xs font-bold uppercase tracking-wide text-soft">{col.heading}</h3>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <a href={l.href} className="text-mist transition hover:text-gold-2">
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-soft">Legal</h3>
              <ul className="mt-4 space-y-2.5 text-sm">
                {legal.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} className="text-mist transition hover:text-gold-2">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="gold-rule mt-10 h-px w-full" />

          <div className="pt-6">
            {/* Compliance-locked. Not console-editable — a marketing edit must
                never be able to remove the risk disclosure. */}
            <p className="text-xs leading-relaxed text-muted">
              Trading and copy trading involve substantial risk and may not be suitable for everyone.
              Leverage can magnify gains and losses. Past performance is not indicative of future
              results. Aglotrends is a software and education platform — it is not a broker, does not
              hold client funds, and does not guarantee trading returns, referral income, rank
              achievement, or rewards. Only commit funds you can afford to place at risk. Information
              on this website is general and does not consider your personal objectives or financial
              circumstances.
            </p>
            <p className="mt-4 text-xs text-mist">
              © {new Date().getFullYear()} Aglotrends. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
