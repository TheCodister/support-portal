"use client";

import { useEffect, useState } from "react";
import { request } from "./api";
import { Icon } from "./icons";
import { dismissalKey, kindMeta, visibleBanners, type Announcement } from "./announcement-kinds";

const DISMISSED_KEY = "supportdesk.dismissed-announcements";

// Dismissals are a per-browser convenience; storage can be unavailable (private windows), so failures are ignored.
function readDismissed() {
  try { const value = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"); return new Set<string>(Array.isArray(value) ? value : []); }
  catch { return new Set<string>(); }
}
function writeDismissed(keys: Set<string>) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...keys].slice(-200))); } catch { /* not persisted */ }
}

export function AnnouncementBanners({ orgId, refreshKey }: { orgId: string; refreshKey: number }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState(readDismissed);
  useEffect(() => {
    let current = true;
    request<{ items: Announcement[] }>("/v1/announcements?active=true&limit=10", {}, orgId).then((data) => { if (current) setItems(data.items); }).catch(() => { if (current) setItems([]); });
    return () => { current = false; };
  }, [orgId, refreshKey]);

  function dismiss(item: Announcement) { const next = new Set(dismissed).add(dismissalKey(item)); setDismissed(next); writeDismissed(next); }

  const visible = visibleBanners(items, dismissed);
  if (!visible.length) return null;
  return <section className="announcement-strip" aria-label="Announcements">{visible.map((item) => <div key={item.id} className={`announcement-banner ${item.kind}`}>
    <span className="announcement-icon"><Icon name={kindMeta[item.kind].icon} size={18}/></span>
    <div className="announcement-text"><strong><span className="kind-tag">{kindMeta[item.kind].label}</span>{item.title}</strong><p>{item.body}</p></div>
    <button className="announcement-dismiss" onClick={() => dismiss(item)} aria-label={`Dismiss ${item.title}`}><Icon name="close" size={16}/></button>
  </div>)}</section>;
}
