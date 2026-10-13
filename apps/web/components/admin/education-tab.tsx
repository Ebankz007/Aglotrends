"use client";

import { useState } from "react";
import {
  ActionButton,
  Badge,
  Empty,
  Field,
  Note,
  Panel,
  Table,
  Td,
  Tr,
} from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  createEducationResource,
  deleteEducationResource,
  fetchAdminEducation,
  updateEducationResource,
  type EducationResourceDto,
  type EducationResourceType,
} from "@/lib/api";

const selectClass =
  "w-full rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50";

const TYPE_TONE: Record<EducationResourceType, string> = {
  ARTICLE: "border-brand/30 bg-brand/10 text-brand-2",
  VIDEO: "border-cyan/30 bg-cyan/10 text-cyan",
  LINK: "border-gold/30 bg-gold/10 text-gold-2",
};

export function EducationTab() {
  const { data, error, loading, reload } = useAsync(fetchAdminEducation);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("Basics");
  const [level, setLevel] = useState("");
  const [resourceType, setResourceType] = useState<EducationResourceType>("ARTICLE");
  const [url, setUrl] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isPublished, setIsPublished] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setOk(null);
    if (!title.trim()) {
      setFormError("Title is required.");
      return;
    }
    setBusy(true);
    try {
      await createEducationResource({
        title: title.trim(),
        summary: summary.trim() || null,
        body: body.trim() || null,
        category: category.trim() || "General",
        level: level.trim() || null,
        resourceType,
        url: url.trim() || null,
        coverImageUrl: coverImageUrl.trim() || null,
        isPublished,
        sortOrder: Number(sortOrder) || 0,
      });
      setOk(isPublished ? "Resource created and published." : "Resource saved as draft.");
      setTitle("");
      setSummary("");
      setBody("");
      setLevel("");
      setUrl("");
      setCoverImageUrl("");
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create the resource.");
    } finally {
      setBusy(false);
    }
  }

  async function onTogglePublish(r: EducationResourceDto) {
    setActionError(null);
    try {
      await updateEducationResource(r.id, { isPublished: !r.isPublished });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update.");
    }
  }

  async function onDelete(r: EducationResourceDto) {
    if (!window.confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
    setActionError(null);
    try {
      await deleteEducationResource(r.id);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not delete.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Add a resource">
        <form onSubmit={onCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Title" value={title} onChange={setTitle} placeholder="Reading price action" />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Type
            </span>
            <select
              className={selectClass}
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value as EducationResourceType)}
            >
              <option value="ARTICLE">ARTICLE</option>
              <option value="VIDEO">VIDEO</option>
              <option value="LINK">LINK</option>
            </select>
          </label>
          <Field label="Category" value={category} onChange={setCategory} placeholder="Basics" />
          <Field label="Level (optional)" value={level} onChange={setLevel} placeholder="Beginner" />
          <Field label="Sort order" value={sortOrder} onChange={setSortOrder} placeholder="0" />
          <Field label="Link URL (optional)" value={url} onChange={setUrl} placeholder="https://…" />
          <Field
            label="Cover image URL (optional)"
            value={coverImageUrl}
            onChange={setCoverImageUrl}
            placeholder="https://…"
          />
          <div className="sm:col-span-2">
            <Field label="Summary (optional)" value={summary} onChange={setSummary} placeholder="One-line teaser" />
          </div>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
              Body (optional)
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="Full article / lesson content…"
              className="w-full resize-y rounded-2xl border border-white/10 bg-night-2 px-4 py-3 text-[15px] text-soft outline-none transition focus:border-brand/50"
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
            />
            Publish immediately
          </label>
          {formError && (
            <div className="sm:col-span-2">
              <Note tone="error">{formError}</Note>
            </div>
          )}
          {ok && (
            <div className="sm:col-span-2">
              <Note tone="ok">{ok}</Note>
            </div>
          )}
          <div className="sm:col-span-2">
            <ActionButton type="submit">{busy ? "Saving…" : "Create resource"}</ActionButton>
          </div>
        </form>
      </Panel>

      <Panel title="Library">
        {actionError && <Note tone="error">{actionError}</Note>}
        {error && <Note tone="error">{error}</Note>}
        {loading ? (
          <Empty>Loading…</Empty>
        ) : data && data.length > 0 ? (
          <Table columns={["Title", "Type", "Category", "Level", "Order", "Status", ""]}>
            {data.map((r) => (
              <Tr key={r.id}>
                <Td className="font-semibold">{r.title}</Td>
                <Td>
                  <Badge className={TYPE_TONE[r.resourceType]}>{r.resourceType}</Badge>
                </Td>
                <Td>{r.category}</Td>
                <Td className="text-mist">{r.level ?? "—"}</Td>
                <Td className="text-mist">{r.sortOrder}</Td>
                <Td>
                  <Badge tone={r.isPublished ? "ok" : "neutral"}>
                    {r.isPublished ? "PUBLISHED" : "DRAFT"}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onTogglePublish(r)}
                      className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-bold text-soft transition hover:bg-white/10"
                    >
                      {r.isPublished ? "Unpublish" : "Publish"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(r)}
                      className="rounded-full border border-red-400/30 bg-red-400/10 px-3 py-1 text-xs font-bold text-red-300 transition hover:bg-red-400/20"
                    >
                      Delete
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        ) : (
          <Empty>No resources yet.</Empty>
        )}
      </Panel>
    </div>
  );
}
