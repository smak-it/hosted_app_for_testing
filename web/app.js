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
  for (const control of document.querySelectorAll('button, textarea')) control.disabled = value;
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, window.location.href), {
    ...options,
    headers: { 'Content-Type': 'application/json' },
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

async function loadNotes() {
  const notes = await request('api/notes');
  const list = document.querySelector('#notes');
  list.replaceChildren();
  document.querySelector('#empty').hidden = notes.length !== 0;
  for (const note of notes) {
    const fragment = document.querySelector('#note-template').content.cloneNode(true);
    fragment.querySelector('.note-body').textContent = note.body;
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
        await loadNotes();
        status.textContent = 'Note deleted.';
      } catch (failure) {
        await loadNotes();
        throw failure;
      } finally { setBusy(false); }
    }));
    for (const button of fragment.querySelectorAll('button')) button.disabled = busy;
    list.append(fragment);
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
action(async () => {
  const info = await request('api/info');
  document.querySelector('#version').textContent = `Release ${info.version}`;
  if (info.message) document.querySelector('#welcome').textContent = info.message;
  await loadNotes();
});
