"use client";

import { useEffect, useState } from "react";
import { ActionButton, Badge, Empty, Note, Panel, Toggle } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  fetchSocialSettings,
  saveSocialSettings,
  type SocialLinkDto,
} from "@/lib/api";

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50";

const labelClass = "mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist";

/** Platforms with a known icon in the footer. `other` renders a generic dot. */
const PLATFORMS: Array<{ value: string; label: string }> = [
  { value: "x", label: "X (Twitter)" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "discord", label: "Discord" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The operator's social handles, rendered in the marketing footer. CONTENT area,
 * not SUPERADMIN — this is public copy, and whoever owns the copy owns the links.
 *
 * Links are ordered by their position here; the arrows rewrite `sortOrder` on
 * every move so the stored order always matches what is on screen.
 */
export function SocialTab() {
  const { data, error, loading } = useAsync(fetchSocialSettings);

  const [links, setLinks] = useState<SocialLinkDto[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (data) setLinks(data.links);
  }, [data]);

  function update(id: string, changes: Partial<SocialLinkDto>) {
    setLinks((ls) => ls?.map((l) => (l.id === id ? { ...l, ...changes } : l)) ?? ls);
  }

  function move(index: number, delta: number) {
    setLinks((ls) => {
      if (!ls) return ls;
      const target = index + delta;
      if (target < 0 || target >= ls.length) return ls;
      const next = [...ls];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((l, i) => ({ ...l, sortOrder: i }));
    });
  }

  function add() {
    setLinks((ls) => [
      ...(ls ?? []),
      {
        id: newId(),
        platform: "x",
        label: "X",
        url: "",
        handle: "",
        enabled: true,
        sortOrder: ls?.length ?? 0,
      },
    ]);
  }

  function remove(id: string) {
    setLinks((ls) =>
      (ls ?? []).filter((l) => l.id !== id).map((l, i) => ({ ...l, sortOrder: i })),
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!links) return;

    // Validate here rather than letting the API reject the whole payload — the
    // operator gets told WHICH row is wrong.
    const bad = links.find((l) => !isValidUrl(l.url));
    if (bad) {
      setNote({
        tone: "error",
        text: `"${bad.label || bad.platform}" needs a full URL starting with https://`,
      });
      return;
    }

    setSaving(true);
    setNote(null);
    try {
      const saved = await saveSocialSettings({ links });
      setLinks(saved.links);
      setNote({ tone: "ok", text: "Social links saved." });
    } catch (err) {
      setNote({ tone: "error", text: err instanceof ApiError ? err.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !links) {
    return (
      <Panel title="Social links">
        {error ? <Note tone="error">{error}</Note> : <Empty>Loading…</Empty>}
      </Panel>
    );
  }

  const visible = links.filter((l) => l.enabled).length;

  return (
    <div className="flex flex-col gap-4">
      {note && <Note tone={note.tone}>{note.text}</Note>}

      <Panel
        title="Social links"
        action={
          <Badge tone={visible > 0 ? "ok" : "neutral"}>
            {visible} shown in footer
          </Badge>
        }
      >
        <p className="mb-4 text-sm text-mist">
          These appear in the marketing footer. Hidden links stay saved but are not published.
          Order here is the order on the page.
        </p>

        {links.length === 0 ? (
          <Empty>No links yet. Add your first below.</Empty>
        ) : (
          <form onSubmit={save} className="flex flex-col gap-3">
            {links.map((link, index) => (
              <div
                key={link.id}
                className="rounded-2xl border border-white/10 bg-night-2/60 p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-soft">
                    {link.label || PLATFORMS.find((p) => p.value === link.platform)?.label || "Link"}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label="Move up"
                      className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-mist transition hover:bg-white/10 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === links.length - 1}
                      aria-label="Move down"
                      className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-mist transition hover:bg-white/10 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(link.id)}
                      aria-label="Remove link"
                      className="grid h-8 w-8 place-items-center rounded-lg border border-danger/30 text-danger transition hover:bg-danger/10"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={labelClass}>Platform</span>
                    <select
                      className={inputClass}
                      value={link.platform}
                      onChange={(e) => update(link.id, { platform: e.target.value })}
                    >
                      {PLATFORMS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className={labelClass}>Label</span>
                    <input
                      className={inputClass}
                      value={link.label}
                      placeholder="Aglotrends"
                      onChange={(e) => update(link.id, { label: e.target.value })}
                    />
                  </label>

                  <label className="block">
                    <span className={labelClass}>URL</span>
                    <input
                      className={inputClass}
                      value={link.url}
                      placeholder="https://x.com/aglotrends"
                      onChange={(e) => update(link.id, { url: e.target.value })}
                    />
                  </label>

                  <label className="block">
                    <span className={labelClass}>Handle (optional)</span>
                    <input
                      className={inputClass}
                      value={link.handle}
                      placeholder="@aglotrends"
                      onChange={(e) => update(link.id, { handle: e.target.value })}
                    />
                  </label>
                </div>

                <div className="mt-3">
                  <Toggle
                    label="Show in footer"
                    checked={link.enabled}
                    onChange={(v) => update(link.id, { enabled: v })}
                  />
                </div>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-3">
              <ActionButton type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save social links"}
              </ActionButton>
              <button
                type="button"
                onClick={add}
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-soft transition hover:bg-white/10"
              >
                + Add link
              </button>
            </div>
          </form>
        )}

        {links.length === 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={add}
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-soft transition hover:bg-white/10"
            >
              + Add link
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}
