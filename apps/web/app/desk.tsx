"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { request } from "./api";
import { Icon } from "./icons";
import { markdownExcerpt } from "./rich-content";

type Membership = { organization_id: string; name: string; role: "requester" | "agent" | "admin" };
type Session = { user: { id: string; email: string; displayName: string }; memberships: Membership[]; csrfToken: string };
type Ticket = { id: string; title: string; description: string; description_format?: "text" | "markdown"; status: string; priority: string; version: number; requester_name: string; assignee_id?: string; assignee_name?: string; created_at: string; comments?: Comment[]; activity?: Activity[]; attachments?: Attachment[] };
type Comment = { id: string; body: string; visibility: string; author_name: string; created_at: string };
type Activity = { id: string; action: string; actor_name?: string; created_at: string };
type Attachment = { id: string; file_name: string; size_bytes: number };
type Member = { id: string; display_name: string; role: string };

const Knowledge = dynamic(() => import("./knowledge").then((module) => module.Knowledge), { ssr: false, loading: () => <main className="loading-screen"><span className="loader"/></main> });
// The editor is loaded only when a ticket form or a formatted description is shown.
const NewTicket = dynamic(() => import("./new-ticket").then((module) => module.NewTicket), { ssr: false });
const TicketDescription = dynamic(() => import("./new-ticket").then((module) => module.TicketDescription), { ssr: false, loading: () => <p className="message-loading">Loading description…</p> });

export function Desk() {
  const [session, setSession] = useState<Session | null>();
  const [orgId, setOrgId] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [activeStatus, setActiveStatus] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [ticketQuery, setTicketQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [view, setView] = useState<"tickets" | "knowledge">("tickets");
  const listRequestId = useRef(0);
  const membership = session?.memberships.find((item) => item.organization_id === orgId);

  const loadTickets = useCallback(async (organizationId: string, query = "", cursor?: string) => {
    const requestId = ++listRequestId.current;
    const params = new URLSearchParams(query);
    if (cursor) params.set("cursor", cursor);
    if (!cursor) { setNextCursor(null); setLoadingMore(false); }
    else setLoadingMore(true);
    try {
      const data = await request<{ items: Ticket[]; nextCursor: string | null }>(`/v1/tickets${params.size ? `?${params}` : ""}`, {}, organizationId);
      if (requestId !== listRequestId.current) return;
      setTickets((current) => cursor ? [...current, ...data.items] : data.items);
      setNextCursor(data.nextCursor);
    }
    catch (caught) { if (requestId === listRequestId.current) setError((caught as Error).message); }
    finally { if (requestId === listRequestId.current) setLoadingMore(false); }
  }, []);
  const openTicket = useCallback(async (id: string, organizationId = orgId) => {
    try { setSelected(await request<Ticket>(`/v1/tickets/${id}`, {}, organizationId)); }
    catch (caught) { setError((caught as Error).message); }
  }, [orgId]);
  useEffect(() => {
    request<Session>("/v1/auth/me").then((value) => { setSession(value); const id = value.memberships[0]?.organization_id ?? ""; setOrgId(id); if (id) void loadTickets(id); }).catch(() => setSession(null));
  }, [loadTickets]);

  if (session === undefined) return <main className="loading-screen"><span className="loader"/><p>Opening SupportDesk</p></main>;
  if (!session) return <Login onLogin={(value) => { setSession(value); const id = value.memberships[0]?.organization_id ?? ""; setOrgId(id); void loadTickets(id); }}/>;

  async function logout() { await request("/v1/auth/logout", { method: "POST" }); setSession(null); }
  async function update(fields: Record<string, unknown>) {
    if (!selected) return;
    try { const next = await request<Ticket>(`/v1/tickets/${selected.id}`, { method: "PATCH", body: JSON.stringify({ ...fields, version: selected.version }) }, orgId); await Promise.all([openTicket(next.id), loadTickets(orgId, ticketQuery)]); }
    catch (caught) { setError((caught as Error).message); }
  }
  function filter(status: string) { const query = status ? `status=${status}` : ""; setActiveStatus(status); setSearchValue(""); setTicketQuery(query); setSelected(null); void loadTickets(orgId, query); }
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const value = searchValue.trim(); const query = value ? `search=${encodeURIComponent(value)}` : ""; setActiveStatus(""); setTicketQuery(query); setSelected(null); void loadTickets(orgId, query); }

  return <div className="app-shell">
    <GlobalNav user={session.user} view={view} onView={setView} onLogout={() => void logout()}/>
    <nav className="workspace-nav" aria-label="Workspace navigation"><div className="nav-container">
      <div className="workspace-identity"><strong>SupportDesk</strong><span className="workspace-divider"/><label><span className="sr-only">Workspace</span><select value={orgId} onChange={(event) => { setOrgId(event.target.value); setSelected(null); setActiveStatus(""); setSearchValue(""); setTicketQuery(""); void loadTickets(event.target.value); }}>{session.memberships.map((item) => <option key={item.organization_id} value={item.organization_id}>{item.name}</option>)}</select></label></div>
      <div className="workspace-links" aria-label="Primary"><button className={view === "tickets" ? "current" : ""} aria-current={view === "tickets" ? "page" : undefined} onClick={() => setView("tickets")}><Icon name="inbox" size={16}/>Tickets</button><button className={view === "knowledge" ? "current" : ""} aria-current={view === "knowledge" ? "page" : undefined} onClick={() => setView("knowledge")}><Icon name="book" size={16}/>Knowledge</button><button disabled><Icon name="people" size={16}/>Customers</button><button disabled><Icon name="chart" size={16}/>Reports</button></div>
      <button className="view-switch" onClick={() => setView(view === "tickets" ? "knowledge" : "tickets")} aria-label={view === "tickets" ? "Open knowledge base" : "Open tickets"}><Icon name={view === "tickets" ? "book" : "inbox"} size={18}/></button>
      {view === "tickets" && <button className="button-primary button-compact" onClick={() => setShowNew(true)}><Icon name="plus" size={16}/>New ticket</button>}
    </div></nav>

    {view === "knowledge" ? <Knowledge orgId={orgId} role={membership?.role ?? "requester"}/> : <main className="dashboard" id="inbox">
      <section className="dashboard-intro"><div><p className="overline">SUPPORT INBOX</p><h1>Every conversation,<br/> in one place.</h1><p className="intro-copy">Listen, respond, and resolve with the full customer story in view.</p></div><div className="intro-stat" aria-label={`${tickets.length} tickets in this view`}><strong>{tickets.length}</strong><span>in this view</span></div></section>
      <section className="inbox-toolbar" aria-label="Ticket controls">
        <div className="segmented-control">{[{ label: "All", value: "" }, { label: "Open", value: "open" }, { label: "Waiting", value: "waiting" }, { label: "Closed", value: "closed" }].map((item) => <button key={item.label} className={activeStatus === item.value ? "active" : ""} onClick={() => filter(item.value)}>{item.label}</button>)}</div>
        <form className="search-field" onSubmit={search} role="search"><Icon name="search" size={16}/><input name="search" maxLength={200} value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Search tickets" aria-label="Search tickets"/><button className="sr-only">Search</button></form>
      </section>
      {error && <button className="error-banner" onClick={() => setError("")}><span>{error}</span><Icon name="close" size={16}/></button>}
      <section className={`inbox-frame ${selected ? "has-selection" : ""}`}>
        <div className="ticket-list" aria-label="Ticket list"><div className="list-heading"><span>Conversation</span><span>Status</span></div>{tickets.length === 0 ? <EmptyTickets onCreate={() => setShowNew(true)}/> : tickets.map((ticket) => <button key={ticket.id} className={`ticket-row ${selected?.id === ticket.id ? "selected" : ""}`} onClick={() => void openTicket(ticket.id)}><span className={`priority-dot ${ticket.priority}`} aria-label={`${ticket.priority} priority`}/><span className="ticket-summary"><strong>{ticket.title}</strong><span>{ticket.description_format === "markdown" ? markdownExcerpt(ticket.description) : ticket.description}</span><small>{ticket.requester_name}<i/> {relativeDate(ticket.created_at)}</small></span><span className={`status-label ${ticket.status}`}>{ticket.status.replace("_", " ")}</span></button>)}{nextCursor && <button className="load-more" disabled={loadingMore} onClick={() => void loadTickets(orgId, ticketQuery, nextCursor)}>{loadingMore ? "Loading…" : "Load more conversations"}</button>}</div>
        <div className="ticket-panel">{selected ? <TicketDetail ticket={selected} role={membership?.role ?? "requester"} orgId={orgId} onClose={() => setSelected(null)} onRefresh={() => openTicket(selected.id)} onUpdate={update}/> : <div className="empty-selection"><span className="empty-icon"><Icon name="inbox" size={30}/></span><h2>Select a conversation</h2><p>Choose a ticket to see its complete history and reply.</p></div>}</div>
      </section>
    </main>}
    {showNew && <NewTicket orgId={orgId} onClose={() => setShowNew(false)} onCreated={(ticket) => { setShowNew(false); void loadTickets(orgId, ticketQuery); void openTicket(ticket.id); }}/>}
  </div>;
}

function GlobalNav({ user, view, onView, onLogout }: { user: Session["user"]; view: string; onView: (view: "tickets" | "knowledge") => void; onLogout: () => void }) {
  return <header className="global-nav"><div className="global-nav-inner"><a className="global-brand" href="#inbox" onClick={() => onView("tickets")} aria-label="SupportDesk home"><Icon name="logo" size={22}/><span>SupportDesk</span></a><nav aria-label="Global"><a href="#inbox" onClick={() => onView("tickets")} aria-current={view === "tickets" ? "page" : undefined}>Workspace</a><a href="#knowledge" onClick={() => onView("knowledge")} aria-current={view === "knowledge" ? "page" : undefined}>Knowledge</a><span aria-disabled="true">Settings</span></nav><div className="global-user"><span className="user-name">{user.displayName}</span><span className="user-avatar">{initials(user.displayName)}</span><button onClick={onLogout} title="Sign out" aria-label="Sign out"><Icon name="logout" size={17}/></button></div></div></header>;
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); const data = new FormData(event.currentTarget); try { onLogin(await request<Session>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) })); } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); } }
  return <main className="login-page"><header className="global-nav"><div className="global-nav-inner login-nav"><span className="global-brand"><Icon name="logo" size={22}/><span>SupportDesk</span></span><span>Thoughtful support, organized.</span></div></header><section className="login-hero"><div className="login-message"><p className="overline">SUPPORTDESK</p><h1>Support that feels<br/>more human.</h1><p>A focused place for your team to listen carefully, respond clearly, and keep every promise.</p></div><form className="login-card" onSubmit={submit}><div><p className="overline">WELCOME BACK</p><h2>Sign in</h2><p>Continue to your support workspace.</p></div><label>Email address<input name="email" type="email" defaultValue="admin@acme.test" autoComplete="email" required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label>{error && <p className="form-error">{error}</p>}<button className="button-primary login-submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button><p className="demo-note">Demo access: admin@acme.test</p></form></section><footer className="login-footer"><span>SupportDesk</span><span>Private by design. Built for clear conversations.</span></footer></main>;
}

function EmptyTickets({ onCreate }: { onCreate: () => void }) { return <div className="empty-tickets"><span className="empty-icon"><Icon name="inbox" size={28}/></span><h2>Your inbox is clear.</h2><p>No tickets match this view.</p><button className="text-button" onClick={onCreate}>Create a ticket</button></div>; }


function TicketDetail({ ticket, role, orgId, onClose, onRefresh, onUpdate }: { ticket: Ticket; role: string; orgId: string; onClose: () => void; onRefresh: () => void; onUpdate: (fields: Record<string, unknown>) => void }) {
  const [internal, setInternal] = useState(false); const [error, setError] = useState(""); const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => { if (role !== "requester") request<Member[]>("/v1/members", {}, orgId).then(setMembers).catch((caught) => setError((caught as Error).message)); }, [role, orgId]);
  async function comment(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const body = new FormData(form).get("body"); try { await request(`/v1/tickets/${ticket.id}/comments`, { method: "POST", body: JSON.stringify({ body, visibility: internal ? "internal" : "public" }) }, orgId); form.reset(); onRefresh(); } catch (caught) { setError((caught as Error).message); } }
  async function upload(file: File) { try { const allocation = await request<{ attachmentId: string; upload: { url: string; fields: Record<string, string> } }>(`/v1/tickets/${ticket.id}/attachments`, { method: "POST", body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size }) }, orgId); const data = new FormData(); Object.entries(allocation.upload.fields).forEach(([key, value]) => data.append(key, value)); data.append("file", file); const uploaded = await fetch(allocation.upload.url, { method: "POST", body: data }); if (!uploaded.ok) throw new Error("Object upload failed"); await request(`/v1/attachments/${allocation.attachmentId}/complete`, { method: "POST" }, orgId); onRefresh(); } catch (caught) { setError((caught as Error).message); } }
  async function download(id: string) { try { const { url } = await request<{ url: string }>(`/v1/attachments/${id}/download`, {}, orgId); window.location.assign(url); } catch (caught) { setError((caught as Error).message); } }
  return <article className="ticket-detail"><header className="detail-header"><button className="mobile-back" onClick={onClose} aria-label="Back to tickets"><Icon name="back" size={20}/>Tickets</button><div className="detail-title"><p className="overline">TICKET {ticket.id.slice(0, 8).toUpperCase()}</p><h2>{ticket.title}</h2></div>{role !== "requester" && <select className="status-select" value={ticket.status} onChange={(event) => void onUpdate({ status: event.target.value })}><option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting">Waiting</option><option value="closed">Closed</option></select>}</header>
    <section className="ticket-metadata" aria-label="Ticket metadata"><div><span>Priority</span><strong className={`priority-text ${ticket.priority}`}>{ticket.priority}</strong></div><div><span>Requester</span><strong>{ticket.requester_name}</strong></div><div><span>Assignee</span>{role === "requester" ? <strong>{ticket.assignee_name ?? "Unassigned"}</strong> : <select value={ticket.assignee_id ?? ""} onChange={(event) => void onUpdate({ assigneeId: event.target.value || null })}><option value="">Unassigned</option>{members.filter((member) => member.role !== "requester").map((member) => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select>}</div></section>
    <section className="conversation" aria-label="Conversation"><Message author={ticket.requester_name} date={ticket.created_at} body={ticket.description}>{ticket.description_format === "markdown" ? <TicketDescription markdown={ticket.description}/> : undefined}</Message>{ticket.comments?.map((item) => <Message key={item.id} author={item.author_name} date={item.created_at} body={item.body} internal={item.visibility === "internal"}/>)}</section>
    {!!ticket.attachments?.length && <section className="attachment-list"><h3>Attachments</h3>{ticket.attachments.map((item) => <button key={item.id} onClick={() => void download(item.id)}><Icon name="download" size={16}/><span>{item.file_name}</span><small>{Math.ceil(item.size_bytes / 1024)} KB</small></button>)}</section>}
    <form className={`composer ${internal ? "internal" : ""}`} onSubmit={comment}><div className="composer-tabs"><button type="button" className={!internal ? "active" : ""} onClick={() => setInternal(false)}>Reply</button>{role !== "requester" && <button type="button" className={internal ? "active" : ""} onClick={() => setInternal(true)}>Internal note</button>}</div><textarea name="body" rows={4} placeholder={internal ? "Write a private note for your team…" : "Write a reply…"} required/>{error && <p className="form-error composer-error">{error}</p>}<div className="composer-actions"><label className="attach-button"><Icon name="paperclip" size={16}/>Attach<input type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }}/></label><button className="button-primary button-compact">{internal ? "Add note" : "Send reply"}</button></div></form>
    {role !== "requester" && !!ticket.activity?.length && <details className="activity"><summary>Activity history <span>{ticket.activity.length}</span></summary>{ticket.activity.map((item) => <p key={item.id}><span><strong>{item.action.replace(".", " ")}</strong> by {item.actor_name ?? "System"}</span><time>{formatDate(item.created_at)}</time></p>)}</details>}
  </article>;
}

function Message({ author, date, body, internal = false, children }: { author: string; date: string; body: string; internal?: boolean; children?: React.ReactNode }) { return <article className={`message ${internal ? "internal" : ""}`}><span className="message-avatar">{initials(author)}</span><div><header><strong>{author}</strong>{internal && <span>Internal note</span>}<time>{formatDate(date)}</time></header>{children ? <div className="message-body">{children}</div> : <p>{body}</p>}</div></article>; }
function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function formatDate(value: string) { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
function relativeDate(value: string) { const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000); if (days <= 0) return "Today"; if (days === 1) return "Yesterday"; if (days < 7) return `${days} days ago`; return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" }); }
