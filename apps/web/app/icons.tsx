export type IconName = "logo" | "search" | "plus" | "inbox" | "people" | "chart" | "logout" | "paperclip" | "download" | "back" | "close" | "book" | "edit" | "image" | "link" | "markdown" | "bold" | "italic" | "list" | "numbered" | "megaphone" | "sparkle" | "wrench" | "alert" | "trash";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, React.ReactNode> = {
    logo: <><rect x="5" y="4" width="14" height="16" rx="4"/><path d="M9 9.5h6M9 13h6M9 16.5h3"/></>,
    search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    inbox: <><path d="M4 5h16v14H4z"/><path d="M4 14h4l2 2h4l2-2h4"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-4 2.5-6 5.5-6s5 2 5.5 6"/><path d="M15 5.5a3 3 0 0 1 0 5.5M16 13c2.5.5 4 2.5 4.5 5"/></>,
    chart: <><path d="M5 19V9M12 19V5M19 19v-7"/></>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/></>,
    paperclip: <path d="m8 12.5 6.2-6.2a3 3 0 0 1 4.2 4.2L10.2 18.7a5 5 0 0 1-7.1-7.1l8-8"/>,
    download: <><path d="M12 4v11M8 11l4 4 4-4M5 20h14"/></>,
    back: <path d="m15 18-6-6 6-6"/>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    book: <><path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9"/></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></>,
    image: <><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5 17 4.5-4.5 3 3L15 13l4 4"/></>,
    link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></>,
    markdown: <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 15V9l2.5 3L12 9v6M16 9v6M14 13l2 2 2-2"/></>,
    bold: <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>,
    italic: <path d="M14 5h-4M14 19h-4M14 5l-4 14"/>,
    list: <><path d="M9 7h11M9 12h11M9 17h11"/><circle cx="5" cy="7" r=".6"/><circle cx="5" cy="12" r=".6"/><circle cx="5" cy="17" r=".6"/></>,
    numbered: <><path d="M10 7h10M10 12h10M10 17h10M4 6l1.5-1V9M4 14.5a1.3 1.3 0 0 1 2.4.6c0 1-2.4 1.9-2.4 2.9h2.6"/></>,
    megaphone: <><path d="M4 10v4h3l8 4V6L7 10z"/><path d="M7 14l1.5 5h2.5L10 15M18 9.5a3 3 0 0 1 0 5"/></>,
    sparkle: <><path d="M12 4l1.8 4.7L18.5 10.5l-4.7 1.8L12 17l-1.8-4.7L5.5 10.5l4.7-1.8z"/><path d="M18.5 16v4M16.5 18h4"/></>,
    wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>,
    alert: <><path d="M12 4 3 19.5h18z"/><path d="M12 10v4.5M12 17.2v.1"/></>,
    trash: <><path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/><path d="M10.5 11v5M13.5 11v5"/></>
  };
  return <svg {...common}>{paths[name]}</svg>;
}
