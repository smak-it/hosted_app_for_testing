import { renderAttachments } from './attachments.js';
const form = document.querySelector('#note-form');
const body = document.querySelector('#body');
const save = document.querySelector('#save');
const cancel = document.querySelector('#cancel');
const error = document.querySelector('#error');
const status = document.querySelector('#status');
let editing = null;
let busy = false;
function setBusy(value) {
  busy = value;
  for (const control of document.querySelectorAll('button, textarea, input')) control.disabled = value;
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, window.location.origin + "/"), {
    ...options,
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `Request failed (${response.status}). Please try again.`);
  }
  return response.status === 204 ? null : response.json();
}

async function action(work) {
  error.hidden = true;
  status.textContent = '';
  try { await work(); }
  catch (failure) { error.textContent = failure.message; error.hidden = false; }
}

function resetEditor() {
  editing = null;
  form.reset();
  save.textContent = 'Add note';
  document.querySelector('#editor-title').textContent = 'New note';
  cancel.hidden = true;
}

let loadRevision = 0;
async function loadNotes() {
  const revision = ++loadRevision;
  const match = /^\/notes\/(\d+)\/?$/.exec(window.location.pathname);
  const notes = match ? [await request(`api/notes/${match[1]}`)] : await request('api/notes');
  document.querySelector('#detail').hidden = !match;
  const list = document.querySelector('#notes');
  const contents = document.createDocumentFragment();
  for (const note of notes) {
    const fragment = document.querySelector('#note-template').content.cloneNode(true);
    fragment.querySelector('.note-body').textContent = note.body;
    const open = fragment.querySelector('.open-note');
    open.href = `/notes/${note.id}`;
    open.addEventListener('click', (event) => { event.preventDefault(); navigateNotes(open.href); });
    const time = fragment.querySelector('time');
    time.dateTime = note.updated_at;
    time.textContent = new Date(note.updated_at).toLocaleString();
    fragment.querySelector('.edit').addEventListener('click', () => {
      editing = note.id;
      body.value = note.body;
      save.textContent = 'Save changes';
      document.querySelector('#editor-title').textContent = 'Edit note';
      cancel.hidden = false;
      body.focus();
    });
    fragment.querySelector('.delete').addEventListener('click', () => action(async () => {
      setBusy(true);
      try {
        await request(`api/notes/${note.id}`, { method: 'DELETE' });
        if (editing === note.id) resetEditor();
        if (/^\/notes\/\d+\/?$/.test(window.location.pathname)) history.replaceState({}, '', '/');
        await loadNotes();
        status.textContent = 'Note deleted.';
      } catch (failure) {
        await loadNotes();
        throw failure;
      } finally { setBusy(false); }
    }));
    await renderAttachments(fragment.querySelector('.attachments'), note.id, { request, action, setBusy, refresh: loadNotes });
    for (const button of fragment.querySelectorAll('button')) button.disabled = busy;
    contents.append(fragment);
  }
  if (revision === loadRevision) {
    list.replaceChildren(contents);
    document.querySelector('#empty').hidden = notes.length !== 0;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  action(async () => {
    setBusy(true);
    try {
      await request(editing === null ? 'api/notes' : `api/notes/${editing}`, {
        method: editing === null ? 'POST' : 'PUT',
        body: JSON.stringify({ body: body.value }),
      });
      resetEditor();
      await loadNotes();
      status.textContent = 'Note saved.';
    } finally { setBusy(false); }
  });
});
cancel.addEventListener('click', resetEditor);
document.querySelector('#refresh').addEventListener('click', () => action(loadNotes));
function navigateNotes(path) {
  history.pushState({}, '', path);
  document.querySelector('#notes').replaceChildren();
  resetEditor();
  action(loadNotes);
}
document.querySelector('#all-notes').addEventListener('click', (event) => { event.preventDefault(); navigateNotes('/'); });
window.addEventListener('popstate', () => { document.querySelector('#notes').replaceChildren(); resetEditor(); action(loadNotes); });
action(async () => {
  const config = await request('api/config');
  document.querySelector('#environment').textContent = `Environment: ${config.environment}`;
  const session = await request('api/session');
  document.querySelector('#session-status').textContent = session.remembered ? 'This browser is remembered.' : 'This browser is not remembered.';
  const info = await request('api/info');
  document.querySelector('#version').textContent = `Release ${info.version}`;
  if (info.message) document.querySelector('#welcome').textContent = info.message;
  await loadNotes();
});
