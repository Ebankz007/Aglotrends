"use client";

import { useEffect, useState } from "react";
import {
  ActionButton,
  Field,
  Note,
  Panel,
  PortalPage,
  Stat,
} from "@/components/portal-ui";
import { useAsync } from "@/lib/hooks";
import {
  ApiError,
  fetchMe,
  fetchNotificationSettings,
  saveNotificationSettings,
  type NotificationSettingsDto,
} from "@/lib/api";
import { shortId } from "@/lib/format";

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-night-2 px-4 py-3">
      <span className="text-sm font-semibold">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-brand" : "bg-white/15"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

export function SettingsCenter() {
  const { data, error, loading } = useAsync(async () => {
    const [user, settings] = await Promise.all([fetchMe(), fetchNotificationSettings()]);
    return { user, settings };
  });

  const [prefs, setPrefs] = useState<NotificationSettingsDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (data?.settings) setPrefs(data.settings);
  }, [data]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!prefs) return;
    setFormError(null);
    setOk(null);
    setBusy(true);
    try {
      const saved = await saveNotificationSettings(prefs);
      setPrefs(saved);
      setOk("Preferences saved.");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save preferences.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalPage title="Settings">
      {error && <Note tone="error">{error}</Note>}

      <Panel title="Profile">
        {loading || !data?.user ? (
          <Note>Loading…</Note>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Name" value={data.user.fullName} />
            <Stat label="Email" value={<span className="break-all text-sm">{data.user.email}</span>} />
            <Stat label="Member ID" value={shortId(data.user.id)} />
            <Stat label="Role" value={data.user.role} />
          </div>
        )}
      </Panel>

      <Panel title="Notification channels">
        {loading || !prefs ? (
          <Note>Loading…</Note>
        ) : (
          <form onSubmit={onSave} className="flex flex-col gap-4">
            <Toggle
              label="Email"
              checked={prefs.emailEnabled}
              onChange={(v) => setPrefs({ ...prefs, emailEnabled: v })}
            />
            <Toggle
              label="WhatsApp"
              checked={prefs.whatsappEnabled}
              onChange={(v) => setPrefs({ ...prefs, whatsappEnabled: v })}
            />
            {prefs.whatsappEnabled && (
              <Field
                label="WhatsApp number"
                value={prefs.whatsappNumber ?? ""}
                onChange={(v) => setPrefs({ ...prefs, whatsappNumber: v || null })}
                placeholder="+234..."
              />
            )}
            <Toggle
              label="Telegram"
              checked={prefs.telegramEnabled}
              onChange={(v) => setPrefs({ ...prefs, telegramEnabled: v })}
            />
            {prefs.telegramEnabled && (
              <Field
                label="Telegram chat ID"
                value={prefs.telegramChatId ?? ""}
                onChange={(v) => setPrefs({ ...prefs, telegramChatId: v || null })}
                placeholder="123456789"
              />
            )}
            {formError && <Note tone="error">{formError}</Note>}
            {ok && <Note tone="ok">{ok}</Note>}
            <ActionButton type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save preferences"}
            </ActionButton>
            <p className="text-xs text-mist">
              A channel that is not configured on the server is skipped safely — your signals still
              appear on the dashboard.
            </p>
          </form>
        )}
      </Panel>
    </PortalPage>
  );
}
