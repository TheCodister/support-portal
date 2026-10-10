"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { request } from "./api";
import { Icon } from "./icons";
import { fromLocalInput, isEnded, kindMeta, kindOrder, toLocalInput, type Announcement, type AnnouncementKind } from "./announcement-kinds";

const filters: { label: string; value: "" | AnnouncementKind }[] = [{ label: "All", value: "" }, { label: "News", value: "news" }, { label: "Maintenance", value: "maintenance" }, { label: "Incidents", value: "incident" }];

export function Announcements({ orgId, role, onChanged }: { orgId: string; role: string; onChanged: () => void }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [kind, setKind] = useState<"" | AnnouncementKind>("");
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const listRequestId = useRef(0);
  const isAdmin = role === "admin";

  const load = useCallback(async (filter: "" | AnnouncementKind = "", cursor?: string) => {
    const requestId = ++listRequestId.current; setLoading(true);
    const params = new URLSearchParams(); if (filter) params.set("kind", filter); if (cursor) params.set("cursor", cursor);
    try {
      const data = await request<{ items: Announcement[]; nextCursor: string | null }>(`/v1/announcements${params.size ? `?${params}` : ""}`, {}, orgId);
      if (requestId !== listRequestId.current) return;
      setItems((current) => cursor ? [...current, ...data.items] : data.items); setNextCursor(data.nextCursor);
    } catch (caught) { if (requestId === listRequestId.current) setError((caught as Error).message); }
    finally { if (requestId === listRequestId.current) setLoading(false); }
  }, [orgId]);
  useEffect(() => { setKind(""); setEditing(null); void load(); }, [load]);

  function filter(value: "" | AnnouncementKind) { setKind(value); void load(value); }
  function saved() { setEditing(null); void load(kind); onChanged(); }
  async function remove(item: Announcement) {
    if (!window.confirm(`Delete "${item.title}"? It disappears for everyone.`)) return;
    try { await request(`/v1/announcements/${item.id}`, { method: "DELETE" }, orgId); void load(kind); onChanged(); }
    catch (caught) { setError((caught as Error).message); }
  }

  return <main className="dashboard announcements" id="announcements">
    <section className="dashboard-intro"><div><p className="overline">ANNOUNCEMENTS</p><h1>What&apos;s happening,<br/> right now.</h1><p className="intro-copy">News, planned maintenance and incidents from your team.</p></div><div className="intro-stat" aria-label={`${items.length} announcements in this view`}><strong>{items.length}</strong><span>in this view</span></div></section>
    <section className="inbox-toolbar" aria-label="Announcement controls">
      <div className="segmented-control">{filters.map((item) => <button key={item.label} className={kind === item.value ? "active" : ""} onClick={() => filter(item.value)}>{item.label}</button>)}</div>
      {isAdmin && <button className="button-primary button-compact" onClick={() => setEditing("new")}><Icon name="plus" size={16}/>New announcement</button>}
    </section>
    {error && <button className="error-banner" onClick={() => setError("")}><span>{error}</span><Icon name="close" size={16}/></button>}
    {items.length === 0 && !loading
      ? <div className="article-empty"><span className="empty-icon"><Icon name="megaphone" size={28}/></span><h2>{kind ? "Nothing of this kind." : "No announcements yet."}</h2><p>{isAdmin ? "Let everyone know about a launch, a maintenance window or an incident." : "Your team hasn't posted any announcements."}</p>{isAdmin && <button className="text-button" onClick={() => setEditing("new")}>Post an announcement</button>}</div>
      : <section className="announcement-list" aria-label="Announcements">{items.map((item) => <article key={item.id} className={`announcement-card ${item.kind} ${isEnded(item) ? "ended" : ""}`}>
        <header><span className="kind-pill"><Icon name={kindMeta[item.kind].icon} size={14}/>{kindMeta[item.kind].label}</span>{isEnded(item) && <span className="ended-pill">Ended</span>}{isAdmin && <span className="card-actions"><button className="text-button" onClick={() => setEditing(item)} aria-label={`Edit ${item.title}`}><Icon name="edit" size={16}/></button><button className="text-button danger" onClick={() => void remove(item)} aria-label={`Delete ${item.title}`}><Icon name="trash" size={16}/></button></span>}</header>
        <h2>{item.title}</h2><p>{item.body}</p>
        <small>Posted {formatDate(item.created_at)}{item.author_name ? ` by ${item.author_name}` : ""}{item.ends_at ? ` · ${isEnded(item) ? "Ended" : "Shown until"} ${formatDate(item.ends_at)}` : ""}</small>
      </article>)}{nextCursor && <button className="load-more article-more" disabled={loading} onClick={() => void load(kind, nextCursor)}>{loading ? "Loading…" : "Load more announcements"}</button>}</section>}
    {editing && isAdmin && <AnnouncementForm orgId={orgId} announcement={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={saved}/>}
  </main>;
}

function AnnouncementForm({ orgId, announcement, onClose, onSaved }: { orgId: string; announcement?: Announcement; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<AnnouncementKind>(announcement?.kind ?? "news");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError("");
    const body = JSON.stringify({ kind, title: data.get("title"), body: data.get("body"), endsAt: fromLocalInput(String(data.get("endsAt") ?? "")), ...(announcement ? { version: announcement.version } : {}) });
    try { await request(announcement ? `/v1/announcements/${announcement.id}` : "/v1/announcements", { method: announcement ? "PATCH" : "POST", body }, orgId); onSaved(); }
    catch (caught) { setError((caught as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={19}/></button>
    <div className="modal-heading"><p className="overline">{announcement ? "EDIT ANNOUNCEMENT" : "NEW ANNOUNCEMENT"}</p><h2>{announcement ? "Update the announcement" : "Tell everyone"}</h2><p>It appears as a banner for every member of this workspace until it ends or they dismiss it.</p></div>
    <fieldset className="kind-picker"><legend>Type</legend>{kindOrder.slice().reverse().map((value) => <label key={value} className={`kind-option ${value} ${kind === value ? "selected" : ""}`}><input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)}/><Icon name={kindMeta[value].icon} size={16}/>{kindMeta[value].label}</label>)}</fieldset>
    <label>Title<input name="title" defaultValue={announcement?.title} minLength={3} maxLength={200} placeholder={kind === "incident" ? "Sign-in is failing for some users" : kind === "maintenance" ? "Scheduled maintenance on Saturday" : "Introducing shared inboxes"} required autoFocus/></label>
    <label>Message<textarea name="body" defaultValue={announcement?.body} maxLength={5000} placeholder="What happened, who is affected, and what happens next." required/></label>
    <label>Show in banner until <span className="optional">optional</span><input name="endsAt" type="datetime-local" defaultValue={toLocalInput(announcement?.ends_at ?? null)}/></label>
    {error && <p className="form-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy}>{busy ? "Saving…" : announcement ? "Save changes" : "Post announcement"}</button></div>
  </form></div>;
}

function formatDate(value: string) { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
