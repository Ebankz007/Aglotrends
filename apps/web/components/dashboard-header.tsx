"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ShieldIcon } from "@/components/icons";
import { fetchMe, isAdminRole, logout, type UserDto } from "@/lib/api";
import { shortId } from "@/lib/format";

function initials(name: string, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

/** Dashboard header: the real member (name, ID, avatar) once a session exists. */
export function DashboardHeader() {
  const router = useRouter();
  const [user, setUser] = useState<UserDto | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((u) => {
        if (!cancelled) {
          setUser(u);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSignOut() {
    await logout();
    setUser(null);
    router.push("/login");
    router.refresh();
  }

  const displayName = user?.fullName ?? "Aglotrends Member";
  const displayId = user ? shortId(user.id) : "—";
  const avatar = user ? initials(user.fullName, user.email) : "AT";

  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-mist">Welcome back,</p>
        <h1 className="mt-0.5 text-xl font-bold tracking-tight text-soft">{displayName}</h1>
        <span className="mt-1.5 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-mist">
          ID: {displayId}
        </span>
        {user && isAdminRole(user.role) && (
          <span
            className={`ml-1.5 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              user.role === "SUPERADMIN"
                ? "border border-amber-300/40 bg-amber-300/10 text-amber-200"
                : "border border-brand/30 bg-brand/10 text-brand-2"
            }`}
          >
            {user.role}
          </span>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-brand to-cyan text-sm font-bold text-night">
          {avatar}
        </div>
        {user && isAdminRole(user.role) && (
          <Link
            href="/admin"
            className="flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-[11px] font-bold text-brand-2 transition hover:bg-brand/20"
          >
            <ShieldIcon className="h-3.5 w-3.5" />
            Admin
          </Link>
        )}
        <Link
          href="/"
          className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-bold text-soft transition hover:bg-white/10"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
          Website
        </Link>
        {loaded && (
          <button
            onClick={() => void onSignOut()}
            className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-bold text-mist transition hover:bg-white/10 hover:text-soft"
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
