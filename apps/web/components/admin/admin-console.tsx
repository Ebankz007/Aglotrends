"use client";

import { useState } from "react";
import { PortalPage } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { fetchMe } from "@/lib/api";
import { MembersTab } from "@/components/admin/members-tab";
import { StaffTab } from "@/components/admin/staff-tab";
import { BrokersTab } from "@/components/admin/brokers-tab";
import { SignalsTab } from "@/components/admin/signals-tab";
import { BroadcastTab } from "@/components/admin/broadcast-tab";
import { ContentTab } from "@/components/admin/content-tab";
import { SettingsTab } from "@/components/admin/settings-tab";
import { SettlementsTab, PoolsTab, PayoutsTab } from "@/components/admin/finance-tabs";
import { PaymentsTab } from "@/components/admin/payments-tab";
import { RanksTab } from "@/components/admin/ranks-tab";
import { AuditTab } from "@/components/admin/audit-tab";

/**
 * Tab registry. `superAdminOnly` tabs are hidden from ADMIN — the API enforces
 * the same boundary, so hiding is UX, not security.
 */
const TABS = [
  { id: "members", label: "Members", superAdminOnly: false },
  { id: "staff", label: "Staff", superAdminOnly: true },
  { id: "brokers", label: "Brokers", superAdminOnly: false },
  { id: "signals", label: "Signals", superAdminOnly: false },
  { id: "broadcast", label: "Broadcast", superAdminOnly: false },
  { id: "content", label: "Content", superAdminOnly: true },
  { id: "settings", label: "Settings", superAdminOnly: true },
  { id: "settlements", label: "Settlements", superAdminOnly: false },
  { id: "ranks", label: "Ranks", superAdminOnly: false },
  { id: "pools", label: "Pools", superAdminOnly: false },
  { id: "payments", label: "Payments", superAdminOnly: false },
  { id: "payouts", label: "Payouts", superAdminOnly: false },
  { id: "audit", label: "Audit", superAdminOnly: false },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AdminConsole() {
  const [tab, setTab] = useState<TabId>("members");
  const { data: me } = useAsync(fetchMe);
  const isSuperAdmin = me?.role === "SUPERADMIN";

  const visibleTabs = TABS.filter((t) => !t.superAdminOnly || isSuperAdmin);

  return (
    <PortalPage title="Admin console">
      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-2 text-sm font-bold transition ${
              tab === t.id
                ? "bg-brand text-night"
                : "border border-white/15 bg-white/5 text-soft hover:bg-white/10"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "members" && <MembersTab />}
      {tab === "staff" && <StaffTab />}
      {tab === "brokers" && <BrokersTab />}
      {tab === "signals" && <SignalsTab />}
      {tab === "broadcast" && <BroadcastTab />}
      {tab === "content" && <ContentTab />}
      {tab === "settings" && <SettingsTab />}
      {tab === "settlements" && <SettlementsTab />}
      {tab === "ranks" && <RanksTab />}
      {tab === "pools" && <PoolsTab />}
      {tab === "payments" && <PaymentsTab />}
      {tab === "payouts" && <PayoutsTab />}
      {tab === "audit" && <AuditTab />}
    </PortalPage>
  );
}
