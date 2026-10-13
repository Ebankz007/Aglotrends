"use client";

import { useEffect, useState } from "react";
import { ActionButton, Empty, Field, Note, Panel } from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import { ApiError, fetchAdminSettings, fetchMe, saveSiteContent } from "@/lib/api";
import { DEFAULT_SITE_CONTENT, mergeSiteContent, type SiteContent } from "@/lib/site-content";

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50";

function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
        {label}
      </span>
      <textarea
        className={inputClass}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="mt-1 block text-xs text-mist">{hint}</span>}
    </label>
  );
}

function RowHeader({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-gold-2">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full border border-red-400/30 bg-red-400/10 px-3 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-400/20"
        >
          Remove
        </button>
      )}
    </div>
  );
}

/**
 * Landing-page copy editor — SUPERADMIN only.
 *
 * Only the marketing surface is editable. The compliance sections (what
 * Aglotrends is not, custody, risk disclosures, the footer) are locked in code
 * on purpose: a copy edit must never be able to remove a risk warning.
 */
export function ContentTab() {
  const { data: me, loading: meLoading } = useAsync(fetchMe);
  const { data, error, loading } = useAsync(fetchAdminSettings);

  const [content, setContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (data) setContent(mergeSiteContent(data.content));
  }, [data]);

  const isSuperAdmin = me?.role === "SUPERADMIN";

  function update<K extends keyof SiteContent>(key: K, value: SiteContent[K]) {
    setContent((c) => ({ ...c, [key]: value }));
  }

  // `next` is `unknown` on purpose: "Reset to defaults" publishes `{}`, which
  // the API stores as an empty override set and the page merges back to defaults.
  async function save(next: unknown, message: string) {
    setSaving(true);
    setNote(null);
    try {
      await saveSiteContent(next);
      setNote({ tone: "ok", text: message });
    } catch (err) {
      setNote({
        tone: "error",
        text: err instanceof ApiError ? err.message : "Could not save content",
      });
    } finally {
      setSaving(false);
    }
  }

  if (meLoading) {
    return (
      <Panel title="Site content">
        <Empty>Loading…</Empty>
      </Panel>
    );
  }

  if (!isSuperAdmin) {
    return (
      <Panel title="Site content">
        <Note tone="info">Only a SUPERADMIN can edit the site content.</Note>
      </Panel>
    );
  }

  if (loading) {
    return (
      <Panel title="Site content">
        {error ? <Note tone="error">{error}</Note> : <Empty>Loading…</Empty>}
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {note && <Note tone={note.tone}>{note.text}</Note>}

      <Panel title="Hero">
        <div className="flex flex-col gap-3">
          <Field
            label="Badge"
            value={content.hero.badge}
            onChange={(v) => update("hero", { ...content.hero, badge: v })}
          />
          <TextArea
            label="Headline"
            value={content.hero.title}
            onChange={(v) => update("hero", { ...content.hero, title: v })}
            rows={2}
            hint="One line per row — each becomes its own line in the headline."
          />
          <TextArea
            label="Sub-headline"
            value={content.hero.subtitle}
            onChange={(v) => update("hero", { ...content.hero, subtitle: v })}
          />
          <Field
            label="Risk note (under the buttons)"
            value={content.hero.riskNote}
            onChange={(v) => update("hero", { ...content.hero, riskNote: v })}
          />
        </div>
      </Panel>

      <Panel title="Stat strip">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {content.stats.map((s, i) => (
            <div key={i} className="rounded-2xl border border-white/10 p-3">
              <RowHeader>Stat {i + 1}</RowHeader>
              <div className="flex flex-col gap-2">
                <Field
                  label="Value"
                  value={s.value}
                  onChange={(v) => {
                    const stats = [...content.stats];
                    stats[i] = { ...s, value: v };
                    update("stats", stats);
                  }}
                />
                <Field
                  label="Label"
                  value={s.label}
                  onChange={(v) => {
                    const stats = [...content.stats];
                    stats[i] = { ...s, label: v };
                    update("stats", stats);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Pillars">
        <div className="flex flex-col gap-3">
          {content.pillars.map((p, i) => (
            <div key={i} className="rounded-2xl border border-white/10 p-3">
              <RowHeader>Pillar {i + 1}</RowHeader>
              <div className="flex flex-col gap-2">
                <Field
                  label="Tag"
                  value={p.tag}
                  onChange={(v) => {
                    const pillars = [...content.pillars];
                    pillars[i] = { ...p, tag: v };
                    update("pillars", pillars);
                  }}
                />
                <Field
                  label="Title"
                  value={p.title}
                  onChange={(v) => {
                    const pillars = [...content.pillars];
                    pillars[i] = { ...p, title: v };
                    update("pillars", pillars);
                  }}
                />
                <TextArea
                  label="Body"
                  value={p.body}
                  onChange={(v) => {
                    const pillars = [...content.pillars];
                    pillars[i] = { ...p, body: v };
                    update("pillars", pillars);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="How it works">
        <div className="flex flex-col gap-3">
          {content.steps.map((s, i) => (
            <div key={i} className="rounded-2xl border border-white/10 p-3">
              <RowHeader>Step {i + 1}</RowHeader>
              <div className="flex flex-col gap-2">
                <Field
                  label="Title"
                  value={s.title}
                  onChange={(v) => {
                    const steps = [...content.steps];
                    steps[i] = { ...s, title: v };
                    update("steps", steps);
                  }}
                />
                <TextArea
                  label="Body"
                  value={s.body}
                  onChange={(v) => {
                    const steps = [...content.steps];
                    steps[i] = { ...s, body: v };
                    update("steps", steps);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="FAQ"
        action={
          <button
            type="button"
            onClick={() => update("faqs", [...content.faqs, { q: "New question", a: "" }])}
            className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-bold text-soft transition hover:bg-white/10"
          >
            Add question
          </button>
        }
      >
        <div className="flex flex-col gap-3">
          {content.faqs.map((f, i) => (
            <div key={i} className="rounded-2xl border border-white/10 p-3">
              <RowHeader
                onRemove={
                  content.faqs.length > 1
                    ? () => update("faqs", content.faqs.filter((_, j) => j !== i))
                    : undefined
                }
              >
                Question {i + 1}
              </RowHeader>
              <div className="flex flex-col gap-2">
                <Field
                  label="Question"
                  value={f.q}
                  onChange={(v) => {
                    const faqs = [...content.faqs];
                    faqs[i] = { ...f, q: v };
                    update("faqs", faqs);
                  }}
                />
                <TextArea
                  label="Answer"
                  value={f.a}
                  onChange={(v) => {
                    const faqs = [...content.faqs];
                    faqs[i] = { ...f, a: v };
                    update("faqs", faqs);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Final call to action">
        <div className="flex flex-col gap-3">
          <Field
            label="Title"
            value={content.finalCta.title}
            onChange={(v) => update("finalCta", { ...content.finalCta, title: v })}
          />
          <TextArea
            label="Body"
            value={content.finalCta.body}
            onChange={(v) => update("finalCta", { ...content.finalCta, body: v })}
          />
          <Field
            label="Footnote"
            value={content.finalCta.note}
            onChange={(v) => update("finalCta", { ...content.finalCta, note: v })}
          />
        </div>
      </Panel>

      <Panel title="Footer & contact">
        <div className="flex flex-col gap-3">
          <TextArea
            label="Footer tagline"
            value={content.footer.tagline}
            onChange={(v) => update("footer", { ...content.footer, tagline: v })}
          />
          <Field
            label="Status badge"
            value={content.footer.badge}
            onChange={(v) => update("footer", { ...content.footer, badge: v })}
          />
          <Field
            label="Contact email"
            value={content.contact.email}
            onChange={(v) => update("contact", { ...content.contact, email: v })}
            placeholder="support@aglotrends.com"
          />
          <Field
            label="Contact phone (optional)"
            value={content.contact.phone}
            onChange={(v) => update("contact", { ...content.contact, phone: v })}
            placeholder="+1 555 000 0000"
          />
          <TextArea
            label="Address (optional)"
            value={content.contact.address}
            onChange={(v) => update("contact", { ...content.contact, address: v })}
            rows={2}
          />
          <Note tone="info">
            Social links live in the <strong>Social</strong> tab. The footer&apos;s risk paragraph is
            fixed in code and is not editable here.
          </Note>
        </div>
      </Panel>

      <Panel title="Publish">
        <p className="mb-3 text-sm text-mist">
          The landing page revalidates within a minute of saving. Compliance sections — custody,
          risk disclosures, and the &ldquo;what Aglotrends is not&rdquo; list — are fixed in code and
          are not editable here.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <ActionButton
            onClick={() => void save(content, "Site content published.")}
            disabled={saving}
          >
            {saving ? "Saving…" : "Publish changes"}
          </ActionButton>
          <ActionButton
            tone="quiet"
            onClick={() => {
              setContent(DEFAULT_SITE_CONTENT);
              void save({}, "Content reset to defaults.");
            }}
            disabled={saving}
          >
            Reset to defaults
          </ActionButton>
        </div>
      </Panel>
    </div>
  );
}
