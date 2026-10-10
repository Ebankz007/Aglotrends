"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/api";

const IDLE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Idle guard: after 15 minutes without interaction, revoke the session and
 * return to the login page. Activity is any pointer, key, or scroll event.
 */
export function InactivityLogout() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function reset() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void logout().finally(() => {
          router.push("/login");
          router.refresh();
        });
      }, IDLE_MS);
    }

    const windowEvents: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "scroll"];
    windowEvents.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    document.addEventListener("visibilitychange", reset);
    reset();

    return () => {
      windowEvents.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener("visibilitychange", reset);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  return null;
}
