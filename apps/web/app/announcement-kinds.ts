import type { IconName } from "./icons";

export type AnnouncementKind = "news" | "maintenance" | "incident";
export type Announcement = { id: string; kind: AnnouncementKind; title: string; body: string; ends_at: string | null; version: number; author_name?: string; created_at: string; updated_at: string };

// The order here is the banner order: an incident outranks planned maintenance, which outranks news.
export const kindMeta: Record<AnnouncementKind, { label: string; icon: IconName }> = {
  incident: { label: "Incident", icon: "alert" },
  maintenance: { label: "Maintenance", icon: "wrench" },
  news: { label: "News", icon: "sparkle" }
};
export const kindOrder = Object.keys(kindMeta) as AnnouncementKind[];

// Keyed by version so an edited announcement is shown again to people who dismissed the earlier text.
export function dismissalKey(item: Pick<Announcement, "id" | "version">) { return `${item.id}:${item.version}`; }

export function isEnded(item: Pick<Announcement, "ends_at">, now = Date.now()) { return item.ends_at !== null && new Date(item.ends_at).getTime() <= now; }

export function visibleBanners<T extends Pick<Announcement, "id" | "version" | "kind" | "ends_at">>(items: T[], dismissed: ReadonlySet<string>, now = Date.now()) {
  return items.filter((item) => !dismissed.has(dismissalKey(item)) && !isEnded(item, now)).sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind));
}

// <input type="datetime-local"> works in local time without a zone; the API stores an absolute instant.
export function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso); const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function fromLocalInput(value: string) { return value ? new Date(value).toISOString() : null; }
