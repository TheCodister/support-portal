"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { request } from "./api";
import { ArticleBody, ArticleEditor, type Article } from "./article-editor";
import { Icon } from "./icons";
import { markdownExcerpt } from "./knowledge-content";

type ArticleSummary = { id: string; title: string; excerpt: string; updated_at: string; updated_by_name: string };
type Mode = { kind: "list" } | { kind: "view"; article: Article } | { kind: "edit"; article?: Article };

export function Knowledge({ orgId, role }: { orgId: string; role: string }) {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const listRequestId = useRef(0);
  const isAdmin = role === "admin";

  const load = useCallback(async (search = "", cursor?: string) => {
    const requestId = ++listRequestId.current; setLoading(true);
    const params = new URLSearchParams(); if (search) params.set("search", search); if (cursor) params.set("cursor", cursor);
    try {
      const data = await request<{ items: ArticleSummary[]; nextCursor: string | null }>(`/v1/knowledge/articles${params.size ? `?${params}` : ""}`, {}, orgId);
      if (requestId !== listRequestId.current) return;
      setArticles((current) => cursor ? [...current, ...data.items] : data.items); setNextCursor(data.nextCursor);
    } catch (caught) { if (requestId === listRequestId.current) setError((caught as Error).message); }
    finally { if (requestId === listRequestId.current) setLoading(false); }
  }, [orgId]);
  useEffect(() => { setMode({ kind: "list" }); setSearchValue(""); setQuery(""); void load(); }, [load]);

  async function open(id: string) {
    try { setMode({ kind: "view", article: await request<Article>(`/v1/knowledge/articles/${id}`, {}, orgId) }); window.scrollTo({ top: 0 }); }
    catch (caught) { setError((caught as Error).message); }
  }
  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const value = searchValue.trim(); setQuery(value); void load(value); }

  return <main className="dashboard knowledge" id="knowledge">
    {mode.kind === "list" && <>
      <section className="dashboard-intro"><div><p className="overline">KNOWLEDGE BASE</p><h1>Answers, written<br/> once.</h1><p className="intro-copy">Guides and fixes your team and customers can rely on.</p></div><div className="intro-stat" aria-label={`${articles.length} articles in this view`}><strong>{articles.length}</strong><span>articles</span></div></section>
      <section className="inbox-toolbar" aria-label="Article controls">
        <form className="search-field" onSubmit={search} role="search"><Icon name="search" size={16}/><input maxLength={200} value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Search articles" aria-label="Search articles"/><button className="sr-only">Search</button></form>
        {isAdmin && <button className="button-primary button-compact" onClick={() => setMode({ kind: "edit" })}><Icon name="plus" size={16}/>New article</button>}
      </section>
    </>}
    {error && <button className="error-banner" onClick={() => setError("")}><span>{error}</span><Icon name="close" size={16}/></button>}
    {mode.kind === "list" && (articles.length === 0 && !loading
      ? <div className="article-empty"><span className="empty-icon"><Icon name="book" size={28}/></span><h2>{query ? "No matching articles." : "No articles yet."}</h2><p>{query ? "Try a different search." : isAdmin ? "Write the first guide for your team and customers." : "Your team hasn't published any articles yet."}</p>{isAdmin && !query && <button className="text-button" onClick={() => setMode({ kind: "edit" })}>Write an article</button>}</div>
      : <section className="article-grid" aria-label="Articles">{articles.map((item) => <button key={item.id} className="article-card" onClick={() => void open(item.id)}><strong>{item.title}</strong><span>{markdownExcerpt(item.excerpt) || "No content yet."}</span><small>Updated {formatDay(item.updated_at)} by {item.updated_by_name}</small></button>)}{nextCursor && <button className="load-more article-more" disabled={loading} onClick={() => void load(query, nextCursor)}>{loading ? "Loading…" : "Load more articles"}</button>}</section>)}
    {mode.kind === "view" && <article className="article-reader">
      <header className="reader-header"><button className="text-button back-link" onClick={() => setMode({ kind: "list" })}><Icon name="back" size={18}/>All articles</button>{isAdmin && <button className="button-secondary button-compact" onClick={() => setMode({ kind: "edit", article: mode.article })}><Icon name="edit" size={16}/>Edit</button>}</header>
      <p className="overline">KNOWLEDGE BASE</p><h1 className="reader-title">{mode.article.title}</h1>
      <p className="reader-meta">Updated {formatDay(mode.article.updated_at)} by {mode.article.updated_by_name}</p>
      <ArticleBody key={`${mode.article.id}:${mode.article.version}`} markdown={mode.article.body}/>
    </article>}
    {mode.kind === "edit" && isAdmin && <ArticleEditor key={mode.article?.id ?? "new"} orgId={orgId} article={mode.article} onCancel={() => setMode(mode.article ? { kind: "view", article: mode.article } : { kind: "list" })} onSaved={(saved) => { void load(query); void open(saved.id); }}/>}
  </main>;
}

function formatDay(value: string) { return new Date(value).toLocaleDateString([], { dateStyle: "medium" }); }
