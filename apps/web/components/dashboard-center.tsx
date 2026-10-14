"use client";

import Link from "next/link";
import { DashboardHeader } from "@/components/dashboard-header";
import { PortalNav } from "@/components/portal-nav";
import { Badge, Empty, Note, Panel, Stat, Table, Td, Tr } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { fetchMe, fetchMyNotifications, fetchMyWallet, fetchNetwork, fetchSignals } from "@/lib/api";
import { formatCents, formatDateTime } from "@/lib/format";

export function DashboardCenter() {
  const { data, error, loading } = useAsync(async () => {
    const me = await fetchMe();
    if (!me) throw new Error("Session expired — please sign in again.");
    // Gated areas 403 for inactive members — don't let their refusals fail
    // the whole dashboard; the activation panel below is the call to action.
    const [balanceCents, network, signals, notifications] = await Promise.all([
      fetchMyWallet(),
      me.isActiveMember
        ? fetchNetwork()
        : Promise.resolve({
            personalReferrals: 0,
            rawTeamVolume: 0,
            eligibleTeamVolume: 0,
            directReferrals: [],
            downlineCount: 0,
            highestAssociateRank: 0,
            highestLeadershipRank: 0,
          }),
      me.isActiveMember ? fetchSignals() : Promise.resolve([]),
      fetchMyNotifications(),
    ]);
    return {
      me,
      balanceCents,
      network,
      signals: signals.slice(0, 4),
      notifications: notifications.slice(0, 4),
    };
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 px-4 pb-10 pt-6 sm:max-w-xl sm:px-6 md:max-w-3xl lg:max-w-6xl lg:px-8 xl:max-w-7xl">
      <DashboardHeader />

      {error && <Note tone="error">{error}</Note>}

      {!loading && data?.me && !data.me.isActiveMember && (
        <Panel title="Membership not active">
          <p className="text-sm text-mist">
            Settle the one-time <span className="font-bold text-soft">$25.00</span> registration fee
            ($20.00 into the plan, $5.00 platform fee) to activate your membership and start
            earning referral and generation bonuses.
          </p>
          <div className="mt-3">
            <Link
              href="/wallet"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-brand px-5 text-sm font-bold text-night transition hover:brightness-110"
            >
              Go to wallet
            </Link>
          </div>
        </Panel>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Wallet" value={loading ? "…" : formatCents(data?.balanceCents ?? 0)} />
        <Stat
          label="Personal referrals"
          value={loading ? "…" : (data?.network.personalReferrals ?? 0)}
        />
        <Stat label="Team size" value={loading ? "…" : (data?.network.downlineCount ?? 0)} />
        <Stat
          label="Associate rank"
          value={loading ? "…" : `Rank ${data?.network.highestAssociateRank ?? 0}`}
        />
      </section>

      <PortalNav isActive={data?.me ? data.me.isActiveMember || data.me.role !== "MEMBER" : true} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel
          title="Latest signals"
          action={
            <Link href="/signals" className="text-xs font-bold text-brand-2 hover:underline">
              View all
            </Link>
          }
        >
          {loading ? (
            <Empty>Loading…</Empty>
          ) : data && data.signals.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {data.signals.map((s) => (
                <li key={s.id} className="rounded-2xl border border-white/10 bg-navy-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">{s.instrument}</span>
                    <Badge tone={s.direction === "BUY" ? "ok" : s.direction === "SELL" ? "danger" : "neutral"}>
                      {s.direction}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-mist">{s.title}</p>
                  <p className="mt-1 text-[11px] text-mist">{formatDateTime(s.publishedAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No published signals yet.</Empty>
          )}
        </Panel>

        <Panel
          title="Recent notifications"
          action={
            <Link href="/notifications" className="text-xs font-bold text-brand-2 hover:underline">
              View all
            </Link>
          }
        >
          {loading ? (
            <Empty>Loading…</Empty>
          ) : data && data.notifications.length > 0 ? (
            <Table columns={["Title", "When"]}>
              {data.notifications.map((n) => (
                <Tr key={n.id}>
                  <Td>
                    <span className="font-semibold">{n.title}</span>
                    {n.body && <p className="mt-0.5 text-xs text-mist">{n.body}</p>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-mist">{formatDateTime(n.createdAt)}</Td>
                </Tr>
              ))}
            </Table>
          ) : (
            <Empty>No notifications yet.</Empty>
          )}
        </Panel>
      </div>
    </main>
  );
}
