"use client";

import { useState } from "react";
import { PortalPage } from "@/components/portal-ui";
import { MembersTab } from "@/components/admin/members-tab";
import { BrokersTab } from "@/components/admin/brokers-tab";
import { SignalsTab } from "@/components/admin/signals-tab";
import { SettlementsTab, PoolsTab, PayoutsTab } from "@/components/admin/finance-tabs";
import { PaymentsTab } from "@/components/admin/payments-tab";
import { RanksTab } from "@/components/admin/ranks-tab";
import { AuditTab } from "@/components/admin/audit-tab";

const TABS = [
  { id: "members", label: "Members" },
  { id: "brokers", label: "Brokers" },
  { id: "signals", label: "Signals" },
  { id: "settlements", label: "Settlements" },
  { id: "ranks", label: "Ranks" },
  { id: "pools", label: "Pools" },
  { id: "payments", label: "Payments" },
  { id: "payouts", label: "Payouts" },
  { id: "audit", label: "Audit" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AdminConsole() {
  const [tab, setTab] = useState<TabId>("members");

  return (
    <PortalPage title="Admin console">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
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
      {tab === "brokers" && <BrokersTab />}
      {tab === "signals" && <SignalsTab />}
      {tab === "settlements" && <SettlementsTab />}
      {tab === "ranks" && <RanksTab />}
      {tab === "pools" && <PoolsTab />}
      {tab === "payments" && <PaymentsTab />}
      {tab === "payouts" && <PayoutsTab />}
      {tab === "audit" && <AuditTab />}
    </PortalPage>
  );
}
