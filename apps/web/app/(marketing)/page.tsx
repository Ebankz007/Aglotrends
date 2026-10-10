import Link from "next/link";
import {
  BrokerIcon,
  CommunityIcon,
  NetworkIcon,
  SignalIcon,
} from "@/components/icons";

const pillars = [
  {
    Icon: BrokerIcon,
    title: "Copy Trading",
    body: "Connect to partner brokers and follow proven traders. You keep control — the copy is placed on your own broker account.",
  },
  {
    Icon: SignalIcon,
    title: "Signal Service",
    body: "Professional trade ideas published to your dashboard and delivered by email, WhatsApp, or Telegram the moment they go live.",
  },
  {
    Icon: NetworkIcon,
    title: "Referral Network",
    body: "A transparent, auditable compensation engine — direct referrals, generation bonuses, a forced 3×3 matrix, and rank pools.",
  },
  {
    Icon: CommunityIcon,
    title: "Trader Community",
    body: "Discover strategies and the traders behind them. Learn the craft alongside a network that grows with you.",
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <section className="py-14 text-center sm:py-20">
        <span className="inline-flex items-center rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-bold text-brand-2">
          Copy Trading · Signals · Network · Community
        </span>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">
          Trade with structure. Grow with a network.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-mist sm:text-lg">
          Aglotrends brings four tools into one platform: follow traders through your own broker,
          receive professional signals, and build a referral network on a compensation engine you
          can actually audit.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/register"
            className="w-full rounded-2xl bg-brand px-6 py-3 text-center font-bold text-night transition hover:brightness-110 sm:w-auto"
          >
            Create your account
          </Link>
          <Link
            href="/login"
            className="w-full rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-center font-bold text-soft transition hover:bg-white/10 sm:w-auto"
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {pillars.map(({ Icon, title, body }) => (
          <div key={title} className="rounded-3xl border border-white/10 bg-navy p-6">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-night-2 text-brand-2">
              <Icon className="h-6 w-6" />
            </span>
            <h2 className="mt-4 text-lg font-bold">{title}</h2>
            <p className="mt-2 text-sm text-mist">{body}</p>
          </div>
        ))}
      </section>

      <section className="mt-12 rounded-3xl border border-white/10 bg-navy-2 p-6 sm:p-10">
        <h2 className="text-2xl font-bold">How it works</h2>
        <ol className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {[
            ["Create your account", "Register in minutes and get your personal referral link."],
            ["Connect a broker", "Open an account with a partner broker and record it here."],
            ["Follow & earn", "Receive signals, follow traders, and grow your network."],
          ].map(([title, body], i) => (
            <li key={title}>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand font-bold text-night">
                {i + 1}
              </span>
              <h3 className="mt-3 font-bold">{title}</h3>
              <p className="mt-1 text-sm text-mist">{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
