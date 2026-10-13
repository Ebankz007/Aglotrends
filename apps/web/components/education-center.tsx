"use client";

import { useMemo, useState } from "react";
import { useAsync } from "@/lib/hooks";
import {
  fetchEducationResources,
  type EducationResourceDto,
  type EducationResourceType,
} from "@/lib/api";
import { PortalPage, Empty, Note, Badge } from "@/components/portal-ui";
import { ArrowUpRightIcon, BookIcon, XIcon } from "@/components/icons";

/** Resource-type colour language: article=blue, video=cyan, link=gold. */
const TYPE_TONE: Record<EducationResourceType, string> = {
  ARTICLE: "border-brand/30 bg-brand/10 text-brand-2",
  VIDEO: "border-cyan/30 bg-cyan/10 text-cyan",
  LINK: "border-gold/30 bg-gold/10 text-gold-2",
};

const TYPE_LABEL: Record<EducationResourceType, string> = {
  ARTICLE: "Article",
  VIDEO: "Video",
  LINK: "Resource",
};

/** Stable per-category colour so a category keeps its hue across the page. */
const PALETTE = [
  "border-brand/30 bg-brand/10 text-brand-2",
  "border-cyan/30 bg-cyan/10 text-cyan",
  "border-gold/30 bg-gold/10 text-gold-2",
  "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300",
  "border-orange-400/30 bg-orange-400/10 text-orange-300",
];

function categoryTone(category: string): string {
  let h = 0;
  for (let i = 0; i < category.length; i += 1) h = (h * 31 + category.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function EducationCenter() {
  const { data, error, loading } = useAsync(fetchEducationResources);
  const [category, setCategory] = useState<string>("ALL");
  const [selected, setSelected] = useState<EducationResourceDto | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of data ?? []) set.add(r.category);
    return ["ALL", ...Array.from(set).sort()];
  }, [data]);

  const visible = useMemo(
    () => (data ?? []).filter((r) => category === "ALL" || r.category === category),
    [data, category],
  );

  return (
    <PortalPage title="Education">
      <section className="surface p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-2">
          Learn the craft
        </p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-soft">
          Courses, guides &amp; resources
        </h2>
        <p className="mt-1.5 text-sm text-mist">
          Everything you need to trade, build your network, and grow with Aglotrends — curated by
          the desk.
        </p>
        <div className="gold-rule mt-4 h-px w-full" />
      </section>

      {error && <Note tone="error">{error}</Note>}

      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
                category === c
                  ? "border-gold/50 bg-gold/15 text-gold-2"
                  : "border-white/10 bg-white/5 text-mist hover:bg-white/10"
              }`}
            >
              {c === "ALL" ? "All" : c}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <Empty>Loading resources…</Empty>
      ) : visible.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r)}
              className="surface surface-hover group flex flex-col p-5 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <Badge className={TYPE_TONE[r.resourceType]}>{TYPE_LABEL[r.resourceType]}</Badge>
                {r.level && (
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
                    {r.level}
                  </span>
                )}
              </div>
              <h3 className="mt-3 text-base font-bold leading-snug text-soft">{r.title}</h3>
              {r.summary && (
                <p className="mt-1.5 line-clamp-3 text-sm text-mist">{r.summary}</p>
              )}
              <div className="mt-4 flex items-center justify-between gap-2 pt-1">
                <Badge className={categoryTone(r.category)}>{r.category}</Badge>
                <span className="inline-flex items-center gap-1 text-xs font-bold text-gold-2 opacity-80 transition group-hover:opacity-100">
                  Open <ArrowUpRightIcon className="h-3.5 w-3.5" />
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Empty>No resources published yet — check back soon.</Empty>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-night/80 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={() => setSelected(null)}
        >
          <article
            className="surface max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="grid h-10 w-10 place-items-center rounded-xl border border-gold/25 bg-gold/10 text-gold-2">
                  <BookIcon className="h-5 w-5" />
                </span>
                <Badge className={TYPE_TONE[selected.resourceType]}>
                  {TYPE_LABEL[selected.resourceType]}
                </Badge>
                <Badge className={categoryTone(selected.category)}>{selected.category}</Badge>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-mist transition hover:bg-white/10"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <h2 className="mt-4 text-xl font-bold tracking-tight text-soft">{selected.title}</h2>
            {selected.level && (
              <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-gold-2">
                {selected.level}
              </p>
            )}
            {selected.summary && <p className="mt-3 text-sm text-mist">{selected.summary}</p>}

            {selected.body && (
              <div className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-soft/90">
                {selected.body}
              </div>
            )}

            {selected.url && (
              <a
                href={selected.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-gold-2 to-gold px-4 text-sm font-bold text-night transition hover:brightness-105"
              >
                Open resource <ArrowUpRightIcon className="h-4 w-4" />
              </a>
            )}
          </article>
        </div>
      )}
    </PortalPage>
  );
}
