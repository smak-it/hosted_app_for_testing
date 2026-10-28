import type { Note, Attachment } from "../../shared/notes";
import { element, errorText } from "./dom";
import { request } from "./api";
import { showAttachments, uploadAttachment } from "./attachments";
import "./messaging";
import "./dialogs";

const workspace = element("#workspace");
const form = element<HTMLFormElement>("#note-form");
const body = element<HTMLTextAreaElement>("#body");
const detail = element("#note-detail");
let notes: Note[] = [];
let selected: Note | null = null;
let editing = false;
let originalBody = "";
let busy = false;
let revision = 0;
let pendingPath: string | null = null;
const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function routeID() {
  const match = /^\/notes\/(\d+)\/?$/.exec(location.pathname);
  return match ? Number(match[1]) : null;
}
function title(note: Note) {
  return note.body.split("\n")[0];
}
function canLeave() {
  return (
    !busy && (!editing || body.value === originalBody || confirm("Discard your unsaved changes?"))
  );
}
function setBusy(value: boolean) {
  busy = value;
  for (const control of document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement
  >("main button, main input, main textarea"))
    control.disabled = value;
  workspace.setAttribute("aria-busy", String(value));
}
async function action(work: () => Promise<void>) {
  if (busy) return;
  element("#error").hidden = true;
  element("#status").textContent = "";
  setBusy(true);
  try {
    await work();
  } catch (error) {
    element("#error").textContent = errorText(error);
    element("#error").hidden = false;
  } finally {
    setBusy(false);
    if (pendingPath !== null) {
      const path = pendingPath;
      pendingPath = null;
      // A failed save leaves a draft; browser navigation must not discard it.
      if (!editing) {
        history.replaceState({}, "", path);
        void action(() => showSelection(true));
      }
    }
  }
}
function renderList() {
  element("#note-count").textContent = `${notes.length} ${notes.length === 1 ? "note" : "notes"}`;
  element("#empty").hidden = notes.length > 0;
  const links = notes.map((note) => {
    const link = document.createElement("a");
    link.className = "note-link";
    link.href = `/notes/${note.id}`;
    if (!editing && note.id === selected?.id) link.setAttribute("aria-current", "page");
    const heading = document.createElement("strong");
    heading.textContent = title(note);
    const excerpt = document.createElement("p");
    excerpt.className = "note-excerpt";
    excerpt.textContent = note.body.split("\n").slice(1).join(" ");
    const date = document.createElement("time");
    date.dateTime = note.updated_at;
    date.textContent = dateFormat.format(new Date(note.updated_at));
    link.append(heading, excerpt, date);
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (canLeave()) navigate(link.pathname);
    });
    return link;
  });
  element("#notes").replaceChildren(...links);
}
async function showSelection(focus = false) {
  const currentRevision = ++revision;
  editing = false;
  form.hidden = true;
  detail.hidden = true;
  selected = null;
  workspace.dataset.detail = String(routeID() !== null);
  const id = routeID();
  element("#placeholder").hidden = notes.length > 0 || id !== null;
  renderList();
  // Direct links can refer to notes outside the latest-200 list.
  const note = id === null ? notes[0] : await request<Note>(`api/notes/${id}`);
  if (!note) {
    if (id !== null)
      throw new Error("This note is no longer available. Return to All notes to choose another.");
    return;
  }
  const files = await request<Attachment[]>(`api/notes/${note.id}/attachments`);
  if (currentRevision !== revision) return;
  renderNote(note);
  showAttachments(files, (item) => {
    if (busy || !confirm(`Remove ${item.filename}?`)) return;
    action(async () => {
      await request(`api/attachments/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      await showSelection();
      element("#status").textContent = "Attachment removed.";
    });
  });
  detail.hidden = false;
  renderList();
  if (focus) element<HTMLElement>("#detail-title").focus({ preventScroll: true });
}
function renderNote(note: Note) {
  selected = note;
  element("#detail-title").textContent = title(note);
  element("#note-body").textContent = note.body.split("\n").slice(1).join("\n");
  element<HTMLTimeElement>("#note-date").dateTime = note.updated_at;
  element("#note-date").textContent = new Date(note.updated_at).toLocaleString();
  element("#placeholder").hidden = true;
  form.hidden = true;
  detail.hidden = false;
}
async function refresh(focus = false) {
  notes = await request<Note[]>("api/notes");
  await showSelection(focus);
}
function navigate(path: string) {
  history.pushState({}, "", path);
  action(() => showSelection(true));
}
function edit(note: Note | null) {
  if (!canLeave()) return;
  ++revision;
  selected = note;
  editing = true;
  originalBody = note?.body ?? "";
  body.value = originalBody;
  workspace.dataset.detail = "true";
  detail.hidden = true;
  element("#placeholder").hidden = true;
  element("#editor-title").textContent = note ? "Edit note" : "New note";
  element("#save").textContent = note ? "Save changes" : "Create note";
  form.hidden = false;
  element("#error").hidden = true;
  renderList();
  body.focus();
}
element("#new-note").addEventListener("click", () => edit(null));
element("#edit").addEventListener("click", () => edit(selected));
element("#cancel").addEventListener("click", () => {
  if (canLeave()) action(() => showSelection());
});
element("#back").addEventListener("click", () => {
  if (canLeave()) navigate("/");
});
element("#refresh").addEventListener("click", () => {
  if (canLeave()) action(() => refresh());
});
element("#delete").addEventListener("click", () => {
  if (!selected || busy || !confirm("Delete this note and its attachments?")) return;
  const id = selected.id;
  action(async () => {
    await request(`api/notes/${id}`, { method: "DELETE" });
    history.replaceState({}, "", "/");
    await refresh();
    element("#status").textContent = "Note deleted.";
    element<HTMLElement>("#new-note").focus();
  });
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = selected?.id;
  action(async () => {
    const saved = await request<Note>(id ? `api/notes/${id}` : "api/notes", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({ body: body.value }),
    });
    // A successful write is complete even if the following refresh fails.
    editing = false;
    renderNote(saved);
    if (!id) showAttachments([], () => {});
    notes = [saved, ...notes.filter((note) => note.id !== saved.id)];
    renderList();
    history.pushState({}, "", `/notes/${saved.id}`);
    element("#status").textContent = id ? "Changes saved." : "Note created.";
    await refresh(true);
  });
});
element<HTMLInputElement>("#file-input").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!selected || !file) return;
  const id = selected.id;
  action(async () => {
    await uploadAttachment(id, file);
    await showSelection();
    element("#status").textContent = "File attached.";
    element<HTMLInputElement>("#file-input").focus();
  });
});
window.addEventListener("popstate", () => {
  ++revision;
  if (busy) {
    pendingPath = location.pathname;
    return;
  }
  // Preserve an unsaved draft; the user can save it or explicitly discard it.
  if (editing) return;
  action(() => showSelection());
});
window.addEventListener("beforeunload", (event) => {
  if (editing && body.value !== originalBody) event.preventDefault();
});
action(() => refresh());
Promise.all([
  request<{ environment: string }>("api/config"),
  request<{ remembered: boolean }>("api/session"),
  request<{ version: string; message: string }>("api/info"),
])
  .then(([config, session, info]) => {
    element("#environment").textContent = config.environment;
    element("#session-status").textContent = session.remembered ? "Remembered" : "Not remembered";
    element("#version").textContent = info.version;
    if (info.message) element("#welcome").textContent = info.message;
  })
  .catch(() => {
    for (const selector of ["#environment", "#session-status", "#version"])
      element(selector).textContent = "Unavailable — reload to retry";
  });
