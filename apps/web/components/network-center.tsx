"use client";

import { Badge, Empty, Note, Panel, PortalPage, Stat, Table, Td, Tr } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { fetchMatrix, fetchMe, fetchNetwork, fetchRankProgress } from "@/lib/api";
import { formatCents, shortId } from "@/lib/format";
import { useState } from "react";

function Progress({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 100;
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-mist">
        <span>{label}</span>
        <span>
          {value.toLocaleString()} / {target.toLocaleString()}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-night-2">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function NetworkCenter() {
  const { data, error, loading } = useAsync(async () => {
    const [me, network, ranks, matrix] = await Promise.all([
      fetchMe(),
      fetchNetwork(),
      fetchRankProgress(),
      fetchMatrix(),
    ]);
    return { me, network, ranks, matrix };
  });
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const link = data?.me?.referralLink;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <PortalPage title="Network">
      {error && <Note tone="error">{error}</Note>}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Personal referrals" value={loading ? "…" : (data?.network.personalReferrals ?? 0)} />
        <Stat label="Team size" value={loading ? "…" : (data?.network.downlineCount ?? 0)} />
        <Stat
          label="Eligible volume"
          value={loading ? "…" : formatCents(data?.network.eligibleTeamVolume ?? 0)}
          hint={`Raw ${loading ? "…" : formatCents(data?.network.rawTeamVolume ?? 0)}`}
        />
        <Stat
          label="Ranks"
          value={loading ? "…" : `A${data?.network.highestAssociateRank ?? 0} · L${data?.network.highestLeadershipRank ?? 0}`}
        />
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Next associate rank">
          {loading ? (
            <Empty>Loading…</Empty>
          ) : data?.ranks.nextAssociate ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-mist">
                Reach <span className="font-bold text-soft">Rank {data.ranks.nextAssociate.rankId}</span> to
                earn a one-time reward of{" "}
                <span className="font-bold text-soft">{formatCents(data.ranks.nextAssociate.rewardCents)}</span>.
              </p>
              <Progress
                label="Personal referrals"
                value={data.ranks.personalReferrals}
                target={data.ranks.nextAssociate.minPersonalReferrals}
              />
              <Progress
                label="Eligible team volume"
                value={data.ranks.eligibleTeamVolume}
                target={data.ranks.nextAssociate.minTeamVolume}
              />
            </div>
          ) : (
            <Empty>You have reached the highest associate rank.</Empty>
          )}
        </Panel>

        <Panel title="Next leadership rank">
          {loading ? (
            <Empty>Loading…</Empty>
          ) : data?.ranks.nextLeadership ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">{data.ranks.nextLeadership.name}</span>
                <Badge tone="info">Reward: {data.ranks.nextLeadership.rewardSku}</Badge>
              </div>
              <ul className="flex flex-col gap-1.5 text-sm text-mist">
                <li>
                  Requires Associate Rank{" "}
                  <span className="font-bold text-soft">{data.ranks.nextLeadership.requiredAssociateRank}</span>
                </li>
                <li>
                  <span className="font-bold text-soft">{data.ranks.nextLeadership.minLegs}</span> qualified
                  legs
                </li>
                <li>
                  <span className="font-bold text-soft">{data.ranks.nextLeadership.minTeamMembers}</span> team
                  members at that rank
                </li>
              </ul>
            </div>
          ) : (
            <Empty>You have reached the highest leadership rank.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="Your 3×3 matrix position">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-brand/30 bg-brand/10 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-2">You</p>
              <p className="font-mono text-sm text-soft">{shortId(data?.matrix.position)}</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => {
                const child = data?.matrix.children[i];
                return (
                  <div
                    key={i}
                    className="rounded-2xl border border-dashed border-white/15 bg-night-2 px-3 py-4 text-center"
                  >
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
                      Slot {i + 1}
                    </p>
                    <p className="mt-1 font-mono text-xs text-soft">
                      {child ? shortId(child) : "Empty"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Your referral link">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data?.me?.referralCode && data?.me?.referralLink ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-mist">
              New members join under you with your code{" "}
              <span className="font-mono font-bold text-soft">{data.me.referralCode}</span> — a
              referrer code is required at registration.
            </p>
            <p className="break-all rounded-xl border border-white/10 bg-night-2 px-3 py-2 font-mono text-xs text-soft">
              {data.me.referralLink}
            </p>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="w-fit rounded-full bg-brand px-5 py-2 text-sm font-bold text-night transition hover:brightness-110 active:scale-[0.99]"
            >
              {copied ? "Copied!" : "Copy referral link"}
            </button>
          </div>
        ) : (
          <Empty>Your referral code is being prepared — reload in a moment.</Empty>
        )}
      </Panel>

      <Panel title="Direct referrals">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.network.directReferrals.length > 0 ? (
          <Table columns={["Member ID"]}>
            {data.network.directReferrals.map((id) => (
              <Tr key={id}>
                <Td className="font-mono text-xs">{id}</Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No direct referrals yet. Share your link to grow your network.</Empty>
        )}
      </Panel>
    </PortalPage>
  );
}
