import Link from "next/link";
import {
  BellIcon,
  BookIcon,
  BrokerIcon,
  CalendarIcon,
  CommunityIcon,
  DashboardIcon,
  LifebuoyIcon,
  NetworkIcon,
  SettingsIcon,
  SignalIcon,
  WalletIcon,
} from "@/components/icons";

const items = [
  { href: "/network", label: "Network", hint: "Referrals, matrix & ranks", Icon: NetworkIcon, gated: true },
  { href: "/wallet", label: "Wallet", hint: "Balance, ledger & payouts", Icon: WalletIcon, gated: false },
  { href: "/signals", label: "Signals", hint: "Published trade ideas", Icon: SignalIcon, gated: true },
  { href: "/brokers", label: "Copy Trading", hint: "Broker links & accounts", Icon: BrokerIcon, gated: true },
  { href: "/community", label: "Community", hint: "Traders & strategies", Icon: CommunityIcon, gated: true },
  { href: "/education", label: "Education", hint: "Courses, guides & resources", Icon: BookIcon, gated: true },
  { href: "/events", label: "Events", hint: "Webinars, workshops & meetups", Icon: CalendarIcon, gated: true },
  { href: "/support", label: "Support", hint: "Help centre & tickets", Icon: LifebuoyIcon, gated: false },
  { href: "/notifications", label: "Notifications", hint: "Alerts & channels", Icon: BellIcon, gated: false },
  { href: "/settings", label: "Settings", hint: "Profile & preferences", Icon: SettingsIcon, gated: false },
  { href: "/dashboard", label: "Dashboard", hint: "Overview", Icon: DashboardIcon, gated: false },
];

/**
 * Grid of portal destinations shown on the dashboard. Members whose membership
 * is not active yet see only the ungated destinations (wallet to settle the
 * fee, support, notifications, settings) — the gated areas unlock on
 * activation, enforced again server-side.
 */
export function PortalNav({ isActive = true }: { isActive?: boolean }) {
  const visible = items.filter((item) => isActive || !item.gated);
  return (
    <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {visible.map(({ href, label, hint, Icon }) => (
        <Link
          key={href}
          href={href}
          className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-navy-2 p-4 transition hover:border-brand/40 hover:bg-navy-3"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-night-2 text-brand-2 transition group-hover:text-soft">
            <Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-soft">{label}</span>
            <span className="block truncate text-xs text-mist">{hint}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
