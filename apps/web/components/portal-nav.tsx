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
  { href: "/network", label: "Network", hint: "Referrals, matrix & ranks", Icon: NetworkIcon },
  { href: "/wallet", label: "Wallet", hint: "Balance, ledger & payouts", Icon: WalletIcon },
  { href: "/signals", label: "Signals", hint: "Published trade ideas", Icon: SignalIcon },
  { href: "/brokers", label: "Copy Trading", hint: "Broker links & accounts", Icon: BrokerIcon },
  { href: "/community", label: "Community", hint: "Traders & strategies", Icon: CommunityIcon },
  { href: "/education", label: "Education", hint: "Courses, guides & resources", Icon: BookIcon },
  { href: "/events", label: "Events", hint: "Webinars, workshops & meetups", Icon: CalendarIcon },
  { href: "/support", label: "Support", hint: "Help centre & tickets", Icon: LifebuoyIcon },
  { href: "/notifications", label: "Notifications", hint: "Alerts & channels", Icon: BellIcon },
  { href: "/settings", label: "Settings", hint: "Profile & preferences", Icon: SettingsIcon },
  { href: "/dashboard", label: "Dashboard", hint: "Overview", Icon: DashboardIcon },
];

/** Grid of portal destinations shown on the dashboard. */
export function PortalNav() {
  return (
    <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(({ href, label, hint, Icon }) => (
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
