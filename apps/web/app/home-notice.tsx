"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { request } from "./api";
import { Icon } from "./icons";
import { noticeKindMeta, type Notice, type NoticeKind } from "./announcement-kinds";

// Pinned to the top of the inbox. There is no dismiss button: it stays until an admin changes or clears it.
export function HomeNotice({ orgId, role }: { orgId: string; role: string }) {
  const [notice, setNotice] = useState<Notice | null>();
  const [editing, setEditing] = useState(false);
  const isAdmin = role === "admin";
  const load = useCallback(async () => {
    try { setNotice((await request<{ notice: Notice | null }>("/v1/notice", {}, orgId)).notice); }
    catch { setNotice(null); }
  }, [orgId]);
  useEffect(() => { setNotice(undefined); setEditing(false); void load(); }, [load]);

  if (notice === undefined) return null;
  return <>
    {notice
      ? <section className={`home-notice ${notice.kind}`} aria-label={`${noticeKindMeta[notice.kind].label} notice`}>
        <span className="notice-icon"><Icon name={noticeKindMeta[notice.kind].icon} size={22}/></span>
        <div className="notice-text"><p className="notice-label">{noticeKindMeta[notice.kind].label}</p><p className="notice-message">{notice.message}</p><small>Updated {formatDate(notice.updated_at)}{notice.updated_by_name ? ` by ${notice.updated_by_name}` : ""}</small></div>
        {isAdmin && <button className="button-secondary button-compact notice-edit" onClick={() => setEditing(true)}><Icon name="edit" size={16}/>Edit</button>}
      </section>
      : isAdmin && <button className="notice-empty" onClick={() => setEditing(true)}><Icon name="plus" size={16}/>Pin a notice to the top of the inbox</button>}
    {editing && isAdmin && <NoticeForm orgId={orgId} notice={notice} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); }} onStale={load}/>}
  </>;
}

function NoticeForm({ orgId, notice, onClose, onSaved, onStale }: { orgId: string; notice: Notice | null; onClose: () => void; onSaved: () => void; onStale: () => Promise<void> }) {
  const [kind, setKind] = useState<NoticeKind>(notice?.kind ?? "released");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError("");
    try { await request("/v1/notice", { method: "PUT", body: JSON.stringify({ kind, message: data.get("message"), ...(notice ? { version: notice.version } : {}) }) }, orgId); onSaved(); }
    // Another admin may have changed the notice; reload it so the next save is made against the current version.
    catch (caught) { setError((caught as Error).message); await onStale(); }
    finally { setBusy(false); }
  }
  async function clear() {
    if (!window.confirm("Clear the notice? It disappears from the inbox for everyone.")) return;
    setBusy(true); setError("");
    try { await request("/v1/notice", { method: "DELETE" }, orgId); onSaved(); }
    catch (caught) { setError((caught as Error).message); await onStale(); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={19}/></button>
    <div className="modal-heading"><p className="overline">INBOX NOTICE</p><h2>{notice ? "Update the notice" : "Pin a notice"}</h2><p>Shown at the top of the inbox for every member. Nobody can dismiss it; change or clear it here when things move on.</p></div>
    <fieldset className="kind-picker"><legend>Type</legend>{(Object.keys(noticeKindMeta) as NoticeKind[]).map((value) => <label key={value} className={`kind-option ${value} ${kind === value ? "selected" : ""}`}><input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)}/><Icon name={noticeKindMeta[value].icon} size={16}/>{noticeKindMeta[value].label}</label>)}</fieldset>
    <label>Message<textarea name="message" defaultValue={notice?.message} maxLength={500} placeholder={kind === "incident" ? "Email notifications are delayed. We're on it." : kind === "maintenance" ? "Read-only on Saturday 02:00–03:00 UTC for a database upgrade." : "Shared inboxes are now available to every team."} required autoFocus/></label>
    {error && <p className="form-error">{error}</p>}
    <div className="modal-actions">{notice && <button type="button" className="text-button danger notice-clear" disabled={busy} onClick={() => void clear()}><Icon name="trash" size={16}/>Clear notice</button>}<button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy}>{busy ? "Saving…" : notice ? "Save changes" : "Pin notice"}</button></div>
  </form></div>;
}

function formatDate(value: string) { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
