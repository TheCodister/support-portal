"use client";

import { FormEvent, useCallback, useState } from "react";
import type { Editor } from "@tiptap/react";
import { API, request } from "./api";
import { RichTextBody, RichTextEditor, uploadImage } from "./rich-text-editor";
import { toStoredMarkdown } from "./rich-content";

export type Article = { id: string; title: string; body: string; version: number; author_name?: string; updated_by_name?: string; updated_at: string };

export function ArticleBody({ markdown }: { markdown: string }) { return <RichTextBody markdown={markdown}/>; }

export function ArticleEditor({ orgId, article, onSaved, onCancel }: { orgId: string; article?: Article; onSaved: (article: Article) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(article?.title ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const upload = useCallback((file: File) => uploadImage(file, orgId, "/v1/knowledge/images", "kb-image"), [orgId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor) return;
    setSaving(true); setError("");
    const body = JSON.stringify({ title, body: toStoredMarkdown(editor.getMarkdown(), API), ...(article ? { version: article.version } : {}) });
    try { onSaved(await request<Article>(article ? `/v1/knowledge/articles/${article.id}` : "/v1/knowledge/articles", { method: article ? "PATCH" : "POST", body }, orgId)); }
    catch (caught) { setError((caught as Error).message); }
    finally { setSaving(false); }
  }

  return <form className="article-editor" onSubmit={save}>
    <header className="editor-header"><div><p className="overline">{article ? "EDIT ARTICLE" : "NEW ARTICLE"}</p><input className="title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Article title" aria-label="Article title" minLength={3} maxLength={200} required autoFocus={!article}/></div></header>
    <RichTextEditor initialMarkdown={article?.body ?? ""} label="Article body" upload={upload} onEditor={setEditor} onUploadingChange={setUploading} onError={setError}/>
    {error && <p className="form-error">{error}</p>}
    <div className="editor-actions"><button type="button" className="button-secondary" onClick={onCancel}>Cancel</button><button className="button-primary" disabled={saving || uploading || !editor}>{saving ? "Saving…" : article ? "Save changes" : "Publish article"}</button></div>
  </form>;
}
