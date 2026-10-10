import Link from "next/link";

export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-night text-soft">
      <div className="app-glow pointer-events-none fixed inset-0" aria-hidden="true" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-night">A</span>
          Aglotrends
        </Link>
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
      <footer className="relative mx-auto max-w-6xl px-4 py-10 text-xs text-mist sm:px-6">
        <p>
          Aglotrends is a software and education platform. It is not a broker and does not hold
          client funds. Trading involves risk; nothing here is a guarantee of profit.
        </p>
        <p className="mt-2">© {new Date().getFullYear()} Aglotrends. All rights reserved.</p>
      </footer>
    </div>
  );
}
