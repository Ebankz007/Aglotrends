"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchMe } from "@/lib/api";
import { InactivityLogout } from "@/components/inactivity-logout";

/**
 * Destinations that require an active membership. Inactive members are sent to
 * the wallet, where the activation panel settles the fee. Staff (admin
 * console) and the funnel pages (wallet, support, settings, dashboard,
 * notifications) are never redirected.
 */
const GATED_PATHS = ["/network", "/signals", "/brokers", "/community", "/education", "/events"];

function isGated(pathname: string): boolean {
  return GATED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Portal shell — the dark member/admin app. Everything behind the session
 * renders inside this; an unauthenticated visitor is bounced to /login.
 */
export default function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((u) => {
        if (cancelled) return;
        if (!u) {
          router.replace("/login");
          return;
        }
        if (u.role === "MEMBER" && !u.isActiveMember && isGated(pathname)) {
          router.replace("/wallet");
          return;
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  return (
    <div className="min-h-screen bg-night text-soft">
      <div className="app-glow pointer-events-none fixed inset-0" aria-hidden="true" />
      <InactivityLogout />
      <div className="relative">
        {ready ? (
          children
        ) : (
          <div className="grid min-h-screen place-items-center">
            <p className="text-sm text-mist">Loading your account…</p>
          </div>
        )}
      </div>
    </div>
  );
}
