"use client";

import { FormEvent, useCallback, useState } from "react";
import type { Editor } from "@tiptap/react";
import { API, request } from "./api";
import { Icon } from "./icons";
import { isUploadedImage, toStoredMarkdown } from "./rich-content";
import { RichTextBody, RichTextEditor, uploadImage } from "./rich-text-editor";

// Ticket descriptions and replies come from requesters, so only images uploaded through the editor are ever loaded.
const ticketImagePolicy = (src: string) => isUploadedImage(src, API, "ticket-image");

export function TicketRichText({ markdown }: { markdown: string }) { return <RichTextBody markdown={markdown} imagePolicy={ticketImagePolicy}/>; }

export function CommentEditor({ orgId, internal, onEditor, onUploadingChange, onError }: { orgId: string; internal: boolean; onEditor: (editor: Editor | null) => void; onUploadingChange: (uploading: boolean) => void; onError: (message: string) => void }) {
  const upload = useCallback((file: File) => uploadImage(file, orgId, "/v1/ticket-images", "ticket-image"), [orgId]);
  return <RichTextEditor compact initialMarkdown="" label={internal ? "Internal note" : "Reply"} upload={upload} imagePolicy={ticketImagePolicy} onEditor={onEditor} onUploadingChange={onUploadingChange} onError={onError}/>;
}

export function NewTicket({ orgId, onClose, onCreated }: { orgId: string; onClose: () => void; onCreated: (ticket: { id: string }) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const upload = useCallback((file: File) => uploadImage(file, orgId, "/v1/ticket-images", "ticket-image"), [orgId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor) return;
    if (editor.isEmpty) { setError("Add a description so your team knows what's wrong."); editor.commands.focus(); return; }
    const data = new FormData(event.currentTarget); setBusy(true); setError("");
    try { onCreated(await request<{ id: string }>("/v1/tickets", { method: "POST", body: JSON.stringify({ title: data.get("title"), description: toStoredMarkdown(editor.getMarkdown(), API), descriptionFormat: "markdown", priority: data.get("priority") }) }, orgId)); }
    catch (caught) { setError((caught as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal new-ticket" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={19}/></button>
    <div className="modal-heading"><p className="overline">NEW CONVERSATION</p><h2>Create a ticket</h2><p>Capture the issue clearly so your team can act quickly. Add screenshots with the image button or by pasting them.</p></div>
    <label>Subject<input name="title" minLength={3} maxLength={200} placeholder="What can we help with?" required autoFocus/></label>
    <div className="field"><span className="field-label">Description</span><RichTextEditor compact initialMarkdown="" label="Ticket description" upload={upload} imagePolicy={ticketImagePolicy} onEditor={setEditor} onUploadingChange={setUploading} onError={setError}/></div>
    <label>Priority<select name="priority"><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
    {error && <p className="form-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy || uploading || !editor}>{busy ? "Creating…" : uploading ? "Uploading…" : "Create ticket"}</button></div>
  </form></div>;
}
