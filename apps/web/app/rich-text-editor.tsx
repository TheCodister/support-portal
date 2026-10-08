"use client";

import { useEffect, useRef, useState } from "react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EditorContent, Extension, mergeAttributes, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { imageTypes } from "@supportdesk/contracts";
import { API, request } from "./api";
import { Icon, type IconName } from "./icons";
import { imageUrl, looksLikeMarkdown, toEditorMarkdown, type ImageScheme } from "./rich-content";

const SAFE_LINK = /^(https?:|mailto:)/i;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Decides which image sources may load. Images that fail it are hidden instead of fetched. */
export type ImagePolicy = (src: string) => boolean;

function richTextExtensions(imagePolicy?: ImagePolicy) {
  const image = imagePolicy ? Image.extend({
    renderHTML({ HTMLAttributes }) {
      if (imagePolicy(String(HTMLAttributes.src ?? ""))) return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
      const { src: _blocked, ...rest } = HTMLAttributes;
      return ["img", mergeAttributes(this.options.HTMLAttributes, rest, { hidden: "hidden", "data-blocked": "true" })];
    }
  }) : Image;
  return [
    StarterKit.configure({
      heading: { levels: [1, 2] }, code: false, codeBlock: false, blockquote: false, horizontalRule: false, strike: false, underline: false,
      link: { openOnClick: false, autolink: true, isAllowedUri: (url, ctx) => SAFE_LINK.test(url) && ctx.defaultValidate(url), HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" } }
    }),
    image.configure({ HTMLAttributes: { loading: "lazy" } }),
    Markdown
  ];
}

const isImageFile = (file: File) => (imageTypes as readonly string[]).includes(file.type);

// Pasting Markdown source renders it as formatted content; pasting or dropping image files uploads them.
const SmartPaste = Extension.create<{ onImage: (file: File) => void }>({
  name: "smartPaste",
  addOptions() { return { onImage: () => undefined }; },
  addProseMirrorPlugins() {
    const editor = this.editor; const options = this.options;
    return [new Plugin({ key: new PluginKey("smartPaste"), props: {
      handlePaste: (_view, event) => {
        const images = Array.from(event.clipboardData?.files ?? []).filter(isImageFile);
        if (images.length) { images.forEach(options.onImage); return true; }
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!looksLikeMarkdown(text)) return false;
        editor.commands.insertContent(text, { contentType: "markdown" }); return true;
      },
      handleDrop: (_view, event) => {
        const images = Array.from(event.dataTransfer?.files ?? []).filter(isImageFile);
        if (!images.length) return false;
        event.preventDefault(); images.forEach(options.onImage); return true;
      }
    } })];
  }
});

/** Uploads an image through the API's presigned-POST flow and returns the URL the editor should display. */
export async function uploadImage(file: File, orgId: string, route: "/v1/knowledge/images" | "/v1/ticket-images", scheme: ImageScheme) {
  if (!isImageFile(file)) throw new Error("Images must be PNG, JPEG, GIF, or WebP.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Images must be 5 MB or smaller.");
  const allocation = await request<{ imageId: string; upload: { url: string; fields: Record<string, string> } }>(route, { method: "POST", body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size }) }, orgId);
  const data = new FormData(); Object.entries(allocation.upload.fields).forEach(([key, value]) => data.append(key, value)); data.append("file", file);
  const uploaded = await fetch(allocation.upload.url, { method: "POST", body: data }); if (!uploaded.ok) throw new Error("Image upload failed");
  await request(`${route}/${allocation.imageId}/complete`, { method: "POST" }, orgId);
  return imageUrl(API, allocation.imageId, scheme);
}

export function RichTextBody({ markdown, imagePolicy }: { markdown: string; imagePolicy?: ImagePolicy }) {
  const editor = useEditor({ editable: false, immediatelyRender: false, extensions: richTextExtensions(imagePolicy), content: toEditorMarkdown(markdown, API), contentType: "markdown" });
  return <EditorContent editor={editor} className="article-content"/>;
}

type RichTextEditorProps = {
  initialMarkdown: string;
  label: string;
  upload: (file: File) => Promise<string>;
  imagePolicy?: ImagePolicy;
  compact?: boolean;
  onEditor: (editor: Editor | null) => void;
  onUploadingChange: (uploading: boolean) => void;
  onError: (message: string) => void;
};

export function RichTextEditor({ initialMarkdown, label, upload, imagePolicy, compact = false, onEditor, onUploadingChange, onError }: RichTextEditorProps) {
  const [uploads, setUploads] = useState(0);
  const [linkValue, setLinkValue] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<(file: File) => void>(() => undefined);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [...richTextExtensions(imagePolicy), SmartPaste.configure({ onImage: (file) => uploadRef.current(file) })],
    content: toEditorMarkdown(initialMarkdown, API), contentType: "markdown",
    editorProps: { attributes: { class: "article-content editing", "aria-label": label } }
  });
  const state = useEditorState({ editor, selector: ({ editor: current }) => current ? {
    paragraph: current.isActive("paragraph"), h1: current.isActive("heading", { level: 1 }), h2: current.isActive("heading", { level: 2 }),
    bold: current.isActive("bold"), italic: current.isActive("italic"), bullet: current.isActive("bulletList"), ordered: current.isActive("orderedList"), link: current.isActive("link")
  } : null });
  useEffect(() => { onEditor(editor); }, [editor, onEditor]);
  useEffect(() => { onUploadingChange(uploads > 0); }, [uploads, onUploadingChange]);

  uploadRef.current = (file: File) => { if (editor) void insertImage(editor, file); };
  async function insertImage(target: Editor, file: File) {
    setUploads((count) => count + 1); onError("");
    try { target.chain().focus().setImage({ src: await upload(file), alt: file.name.replace(/\.[^.]+$/, "") }).run(); }
    catch (caught) { onError((caught as Error).message); }
    finally { setUploads((count) => count - 1); }
  }

  function openLink() { if (!editor) return; setLinkValue(editor.getAttributes("link").href ?? "https://"); }
  function applyLink() {
    if (!editor || linkValue === null) return;
    const href = linkValue.trim();
    if (!href) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else if (!SAFE_LINK.test(href)) { onError("Links must start with https://, http://, or mailto:"); return; }
    else if (editor.state.selection.empty && !editor.isActive("link")) editor.chain().focus().insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkValue(null); onError("");
  }

  const tool = (name: string, icon: IconName | null, active: boolean | undefined, run: () => void, text?: string) =>
    <button type="button" className={active ? "active" : ""} aria-pressed={!!active} title={name} aria-label={name} onMouseDown={(event) => event.preventDefault()} onClick={run} disabled={!editor}>{icon ? <Icon name={icon} size={16}/> : text}</button>;

  return <div className={`rich-text${compact ? " compact" : ""}`}>
    <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
      <div className="tool-group">
        {tool("Normal text", null, state?.paragraph && !state.bullet && !state.ordered, () => editor?.chain().focus().setParagraph().run(), "Text")}
        {tool("Heading 1", null, state?.h1, () => editor?.chain().focus().toggleHeading({ level: 1 }).run(), "H1")}
        {tool("Heading 2", null, state?.h2, () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), "H2")}
      </div>
      <div className="tool-group">
        {tool("Bold", "bold", state?.bold, () => editor?.chain().focus().toggleBold().run())}
        {tool("Italic", "italic", state?.italic, () => editor?.chain().focus().toggleItalic().run())}
        {tool("Bulleted list", "list", state?.bullet, () => editor?.chain().focus().toggleBulletList().run())}
        {tool("Numbered list", "numbered", state?.ordered, () => editor?.chain().focus().toggleOrderedList().run())}
      </div>
      <div className="tool-group">
        {tool("Link", "link", state?.link, openLink)}
        {tool("Image", "image", false, () => fileInput.current?.click())}
        <input ref={fileInput} type="file" accept={imageTypes.join(",")} hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) uploadRef.current(file); }}/>
      </div>
      <button type="button" className="markdown-button" onClick={() => setShowImport(true)} disabled={!editor}><Icon name="markdown" size={16}/>Paste Markdown</button>
    </div>
    {linkValue !== null && <div className="link-bar"><Icon name="link" size={16}/><input value={linkValue} onChange={(event) => setLinkValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setLinkValue(null); if (event.key === "Enter") { event.preventDefault(); applyLink(); } }} aria-label="Link URL" autoFocus/><button type="button" className="text-button" onClick={applyLink}>Apply</button>{state?.link && <button type="button" className="text-button" onClick={() => { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkValue(null); }}>Remove</button>}</div>}
    <div className="editor-surface"><EditorContent editor={editor}/>{uploads > 0 && <p className="upload-status"><span className="loader"/>Uploading image…</p>}</div>
    <p className="editor-hint">Paste Markdown and it renders automatically. Paste or drop an image to upload it.</p>
    {showImport && editor && <MarkdownImport onClose={() => setShowImport(false)} onInsert={(markdown, replace) => { if (replace) editor.commands.setContent(markdown, { contentType: "markdown" }); else editor.chain().focus().insertContent(markdown, { contentType: "markdown" }).run(); setShowImport(false); }}/>}
  </div>;
}

function MarkdownImport({ onClose, onInsert }: { onClose: () => void; onInsert: (markdown: string, replace: boolean) => void }) {
  const [markdown, setMarkdown] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textarea.current?.focus(); }, []);
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal markdown-modal" role="dialog" aria-modal="true" aria-labelledby="markdown-title" onMouseDown={(event) => event.stopPropagation()}>
    <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Close"><Icon name="close" size={19}/></button>
    <div className="modal-heading"><p className="overline">IMPORT</p><h2 id="markdown-title">Paste Markdown</h2><p>Headings, links, images, lists, and emphasis are converted into formatted text.</p></div>
    <label>Markdown<textarea ref={textarea} rows={12} value={markdown} onChange={(event) => setMarkdown(event.target.value)} placeholder={"# Heading 1\n\n## Heading 2\n\nNormal text with a [link](https://example.com)."} spellCheck={false}/></label>
    <div className="modal-actions"><button type="button" className="button-secondary" onClick={() => onInsert(markdown, false)} disabled={!markdown.trim()}>Insert at cursor</button><button type="button" className="button-primary" onClick={() => onInsert(markdown, true)} disabled={!markdown.trim()}>Replace all</button></div>
  </div></div>;
}
