import Link from "next/link";

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

const legal = ["Risk disclosure", "Terms of Service", "Privacy Policy"];

export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-night text-soft">
      <div className="app-glow pointer-events-none fixed inset-0" aria-hidden="true" />

      {/* Risk banner */}
      <div className="relative border-b border-white/10 bg-navy/60">
        <p className="mx-auto max-w-6xl px-4 py-2 text-center text-[11px] text-mist sm:px-6">
          Trading and copy trading involve substantial risk and may result in loss. Returns and
          referral income are not guaranteed.
        </p>
      </div>

      <header className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-night">A</span>
          Aglotrends
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-mist md:flex">
          {navLinks.map((l) => (
            <a key={l.href} href={l.href} className="transition hover:text-soft">
              {l.label}
            </a>
          ))}
        </nav>
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href="/login"
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 font-bold text-soft transition hover:bg-white/10"
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
      </header>

      <div className="relative">{children}</div>

      <footer className="relative mt-16 border-t border-white/10 bg-night-2">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div>
              <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-night">
                  A
                </span>
                Aglotrends
              </Link>
              <p className="mt-4 max-w-xs text-sm text-mist">
                Copy trading, signals, a referral network, and a trader community — built around
                personal broker custody and visible controls.
              </p>
              <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold text-mist">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan" />
                Platform live — registration open
              </p>
            </div>

            {footerNav.map((col) => (
              <div key={col.heading}>
                <h3 className="text-xs font-bold uppercase tracking-wide text-soft">{col.heading}</h3>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <a href={l.href} className="text-mist transition hover:text-soft">
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
                  <li key={l} className="text-mist">
                    {l} <span className="text-muted">· Pending</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-10 border-t border-white/10 pt-6">
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
