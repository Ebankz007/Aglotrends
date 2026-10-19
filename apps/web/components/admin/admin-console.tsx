"use client";

import { useState } from "react";
import { Note, PortalPage } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { canViewArea, fetchMe, isStaffRole } from "@/lib/api";
import { TwoFactorEnrollment } from "@/components/two-factor-panel";
import { MembersTab } from "@/components/admin/members-tab";
import { StaffTab } from "@/components/admin/staff-tab";
import { BrokersTab } from "@/components/admin/brokers-tab";
import { SignalsTab } from "@/components/admin/signals-tab";
import { SubscriptionPlansTab } from "@/components/admin/subscription-plans-tab";
import { BroadcastTab } from "@/components/admin/broadcast-tab";
import { ContentTab } from "@/components/admin/content-tab";
import { SocialTab } from "@/components/admin/social-tab";
import { SettingsTab } from "@/components/admin/settings-tab";
import { IntegrationsTab } from "@/components/admin/integrations-tab";
import { SettlementsTab, PoolsTab, PayoutsTab } from "@/components/admin/finance-tabs";
import { PaymentsTab } from "@/components/admin/payments-tab";
import { FeesTab } from "@/components/admin/fees-tab";
import { KycTab } from "@/components/admin/kyc-tab";
import { EducationTab } from "@/components/admin/education-tab";
import { EventsTab } from "@/components/admin/events-tab";
import { SupportTab } from "@/components/admin/support-tab";
import { RanksTab } from "@/components/admin/ranks-tab";
import { AuditTab } from "@/components/admin/audit-tab";

/**
 * Tab registry. `area` is the permission the API enforces on that tab's routes;
 * `superAdminOnly` marks routes gated to SUPERADMIN. Both are UX filters only —
 * the API is the boundary, so hiding a tab is never the security control.
 */
const TABS = [
  { id: "members", label: "Members", area: "MEMBERS", superAdminOnly: false },
  { id: "staff", label: "Staff", area: "STAFF", superAdminOnly: true },
  { id: "brokers", label: "Brokers", area: "BROKERS", superAdminOnly: false },
  { id: "signals", label: "Signals", area: "SIGNALS", superAdminOnly: false },
  { id: "subscription-plans", label: "Subscription Plans", area: "SIGNALS", superAdminOnly: false },
  { id: "broadcast", label: "Broadcast", area: "CONTENT", superAdminOnly: false },
  { id: "content", label: "Content", area: "CONTENT", superAdminOnly: true },
  { id: "social", label: "Social", area: "CONTENT", superAdminOnly: false },
  { id: "settings", label: "Settings", area: "SETTINGS", superAdminOnly: true },
  { id: "integrations", label: "Integrations", area: "SETTINGS", superAdminOnly: true },
  { id: "settlements", label: "Settlements", area: "FINANCE", superAdminOnly: false },
  { id: "ranks", label: "Ranks", area: "FINANCE", superAdminOnly: false },
  { id: "pools", label: "Pools", area: "FINANCE", superAdminOnly: false },
  { id: "payments", label: "Payments", area: "FINANCE", superAdminOnly: false },
  { id: "fees", label: "Fees", area: "FINANCE", superAdminOnly: true },
  { id: "kyc", label: "KYC", area: "KYC", superAdminOnly: false },
  { id: "education", label: "Education", area: "CONTENT", superAdminOnly: false },
  { id: "events", label: "Events", area: "CONTENT", superAdminOnly: false },
  { id: "support", label: "Support", area: "CONTENT", superAdminOnly: false },
  { id: "payouts", label: "Payouts", area: "FINANCE", superAdminOnly: false },
  { id: "audit", label: "Audit", area: "AUDIT", superAdminOnly: false },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AdminConsole() {
  const [tab, setTab] = useState<TabId>("members");
  const { data: me, loading, reload } = useAsync(fetchMe);

  if (loading && !me) {
    return (
      <PortalPage title="Admin console">
        <Note>Loading…</Note>
      </PortalPage>
    );
  }

  if (!me) {
    return (
      <PortalPage title="Admin console">
        <Note tone="error">Could not load your account. Please sign in again.</Note>
      </PortalPage>
    );
  }

  // The portal layout only proves *authentication*, not staff role, so a plain
  // member can reach this page. Refuse before the 2FA gate — otherwise a member
  // would be prompted to enrol a second factor for a console they cannot use.
  if (!isStaffRole(me.role)) {
    return (
      <PortalPage title="Admin console">
        <Note tone="error">This area is for staff accounts only.</Note>
      </PortalPage>
    );
  }

  // Hard gate. Every /api/admin/* route answers TWO_FACTOR_REQUIRED until a
  // second factor is enrolled, so there is nothing behind this door yet.
  if (!me.twoFactorEnabled) {
    return (
      <PortalPage title="Admin console">
        <TwoFactorEnrollment
          intro={
            <Note tone="warn">
              The admin console requires two-factor authentication. Enrol an authenticator app to
              continue — this is enforced for every staff account.
            </Note>
          }
          onDone={reload}
        />
      </PortalPage>
    );
  }

  const isSuperAdmin = me.role === "SUPERADMIN";
  const visibleTabs = TABS.filter(
    (t) => (!t.superAdminOnly || isSuperAdmin) && canViewArea(me, t.area),
  );

  if (visibleTabs.length === 0) {
    return (
      <PortalPage title="Admin console">
        <Note tone="warn">
          Your account has no admin areas granted. Ask a superadmin to assign access.
        </Note>
      </PortalPage>
    );
  }

  // The default tab may not be one this account can see.
  const active = visibleTabs.some((t) => t.id === tab) ? tab : visibleTabs[0].id;

  return (
    <PortalPage title="Admin console">
      {me.viewOnly && (
        <Note tone="warn">View-only access — changes are disabled for your account.</Note>
      )}

      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-2 text-sm font-bold transition ${
              active === t.id
                ? "bg-brand text-night"
                : "border border-white/15 bg-white/5 text-soft hover:bg-white/10"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === "members" && <MembersTab />}
      {active === "staff" && <StaffTab />}
      {active === "brokers" && <BrokersTab />}
      {active === "signals" && <SignalsTab />}
      {active === "subscription-plans" && <SubscriptionPlansTab />}
      {active === "broadcast" && <BroadcastTab />}
      {active === "content" && <ContentTab />}
      {active === "social" && <SocialTab />}
      {active === "settings" && <SettingsTab />}
      {active === "integrations" && <IntegrationsTab />}
      {active === "settlements" && <SettlementsTab />}
      {active === "ranks" && <RanksTab />}
      {active === "pools" && <PoolsTab />}
      {active === "payments" && <PaymentsTab />}
      {active === "fees" && <FeesTab />}
      {active === "kyc" && <KycTab />}
      {active === "education" && <EducationTab />}
      {active === "events" && <EventsTab />}
      {active === "support" && <SupportTab />}
      {active === "payouts" && <PayoutsTab />}
      {active === "audit" && <AuditTab />}
    </PortalPage>
  );
}
