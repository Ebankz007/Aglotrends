import type { ReactNode } from "react";

export interface LegalSection {
  heading: string;
  body: ReactNode[];
}

/**
 * Compliance-locked legal documents. These pages are hardcoded, never
 * console-editable — a marketing edit must never be able to soften, remove,
 * or rewrite the risk disclosure, the terms, or the privacy policy.
 */
export function LegalDoc({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-8 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-wide text-gold-2">Legal</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-xs text-muted">Last updated: {updated}</p>
      <p className="mt-5 text-sm leading-relaxed text-mist">{intro}</p>
      <div className="mt-8 flex flex-col gap-7">
        {sections.map((s, i) => (
          <section key={s.heading}>
            <h2 className="text-base font-bold text-soft">
              {i + 1}. {s.heading}
            </h2>
            <div className="mt-2 flex flex-col gap-3 text-sm leading-relaxed text-mist">
              {s.body.map((p, j) => (
                <div key={j}>{p}</div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

/** Bulleted list inside a legal section. */
export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
