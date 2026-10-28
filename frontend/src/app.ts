import type { Note } from "../../shared/notes";
import { element, errorText } from "./dom";
import "./messaging";
import { renderAttachments } from "./attachments";
const form = element<HTMLFormElement>("#note-form");
const body = element<HTMLTextAreaElement>("#body");
const save = element<HTMLButtonElement>("#save");
const cancel = element<HTMLButtonElement>("#cancel");
const error = element<HTMLElement>("#error");
const status = element<HTMLElement>("#status");
let editing: number | null = null;
let busy = false;
function setBusy(value: boolean) {
  busy = value;
  for (const control of document.querySelectorAll<
    HTMLButtonElement | HTMLTextAreaElement | HTMLInputElement
  >("button, textarea, input"))
    control.disabled = value;
}

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(path, window.location.origin + "/"), {
    ...options,
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `Request failed (${response.status}). Please try again.`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

async function action(work: () => Promise<void>) {
  error.hidden = true;
  status.textContent = "";
  try {
    await work();
  } catch (failure) {
    error.textContent = errorText(failure);
    error.hidden = false;
  }
}

function resetEditor() {
  editing = null;
  form.reset();
  save.textContent = "Add note";
  element<HTMLElement>("#editor-title").textContent = "New note";
  cancel.hidden = true;
}

let loadRevision = 0;
async function loadNotes() {
  const revision = ++loadRevision;
  const match = /^\/notes\/(\d+)\/?$/.exec(window.location.pathname);
  const notes = match
    ? [await request<Note>(`api/notes/${match[1]}`)]
    : await request<Note[]>("api/notes");
  element<HTMLElement>("#detail").hidden = !match;
  const list = element<HTMLElement>("#notes");
  const contents = document.createDocumentFragment();
  for (const note of notes) {
    const fragment = element<HTMLTemplateElement>("#note-template").content.cloneNode(
      true,
    ) as DocumentFragment;
    element<HTMLElement>(".note-body", fragment).textContent = note.body;
    const open = element<HTMLAnchorElement>(".open-note", fragment);
    open.href = `/notes/${note.id}`;
    open.addEventListener("click", (event) => {
      event.preventDefault();
      navigateNotes(open.href);
    });
    const time = element<HTMLTimeElement>("time", fragment);
    time.dateTime = note.updated_at;
    time.textContent = new Date(note.updated_at).toLocaleString();
    element<HTMLElement>(".edit", fragment).addEventListener("click", () => {
      editing = note.id;
      body.value = note.body;
      save.textContent = "Save changes";
      element<HTMLElement>("#editor-title").textContent = "Edit note";
      cancel.hidden = false;
      body.focus();
    });
    element<HTMLElement>(".delete", fragment).addEventListener("click", () =>
      action(async () => {
        setBusy(true);
        try {
          await request(`api/notes/${note.id}`, { method: "DELETE" });
          if (editing === note.id) resetEditor();
          if (/^\/notes\/\d+\/?$/.test(window.location.pathname)) history.replaceState({}, "", "/");
          await loadNotes();
          status.textContent = "Note deleted.";
        } catch (failure) {
          await loadNotes();
          throw failure;
        } finally {
          setBusy(false);
        }
      }),
    );
    await renderAttachments(element<HTMLElement>(".attachments", fragment), note.id, {
      request,
      action,
      setBusy,
      refresh: loadNotes,
    });
    for (const button of fragment.querySelectorAll("button")) button.disabled = busy;
    contents.append(fragment);
  }
  if (revision === loadRevision) {
    list.replaceChildren(contents);
    element<HTMLElement>("#empty").hidden = notes.length !== 0;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  action(async () => {
    setBusy(true);
    try {
      await request(editing === null ? "api/notes" : `api/notes/${editing}`, {
        method: editing === null ? "POST" : "PUT",
        body: JSON.stringify({ body: body.value }),
      });
      resetEditor();
      await loadNotes();
      status.textContent = "Note saved.";
    } finally {
      setBusy(false);
    }
  });
});
cancel.addEventListener("click", resetEditor);
element<HTMLElement>("#refresh").addEventListener("click", () => action(loadNotes));
function navigateNotes(path: string) {
  history.pushState({}, "", path);
  element<HTMLElement>("#notes").replaceChildren();
  resetEditor();
  action(loadNotes);
}
element<HTMLElement>("#all-notes").addEventListener("click", (event) => {
  event.preventDefault();
  navigateNotes("/");
});
window.addEventListener("popstate", () => {
  element<HTMLElement>("#notes").replaceChildren();
  resetEditor();
  action(loadNotes);
});
action(async () => {
  const config = await request<{ environment: string }>("api/config");
  element<HTMLElement>("#environment").textContent = `Environment: ${config.environment}`;
  const session = await request<{ remembered: boolean }>("api/session");
  element<HTMLElement>("#session-status").textContent = session.remembered
    ? "This browser is remembered."
    : "This browser is not remembered.";
  const info = await request<{ version: string; message: string }>("api/info");
  element<HTMLElement>("#version").textContent = `Release ${info.version}`;
  if (info.message) element<HTMLElement>("#welcome").textContent = info.message;
  await loadNotes();
});
