export async function renderAttachments(section, noteID, { request, action, setBusy, refresh }) {
  const items = await request(`api/notes/${noteID}/attachments`);
  const title = document.createElement('h3');
  title.textContent = 'Attachments';
  section.append(title);
  for (const item of items) {
    const row = document.createElement('p');
    const link = document.createElement('a');
    link.href = new URL(`api/attachments/${item.id}`, window.location.origin + "/");
    link.textContent = item.filename;
    link.download = item.filename;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = 'Delete attachment';
    remove.setAttribute('aria-label', `Delete attachment ${item.filename}`);
    remove.addEventListener('click', () => action(async () => {
      setBusy(true);
      try { await request(`api/attachments/${item.id}`, { method: 'DELETE' }); await refresh(); }
      finally { setBusy(false); }
    }));
    row.append(link, ' ', remove);
    section.append(row);
  }
  const form = document.createElement('form');
  const label = document.createElement('label');
  label.textContent = 'Attach a file';
  const input = document.createElement('input');
  input.type = 'file';
  input.required = true;
  input.setAttribute('aria-label', 'Attach a file');
  label.append(input);
  const upload = document.createElement('button');
  upload.type = 'submit';
  upload.textContent = 'Upload attachment';
  form.append(label, upload);
  form.addEventListener('submit', event => {
    event.preventDefault();
    action(async () => {
      const file = input.files[0];
      if (!file || file.size > 8 * 1024 * 1024) throw new Error('Choose a file of at most 8 MiB.');
      const body = new FormData();
      body.append('file', file);
      setBusy(true);
      try { await request(`api/notes/${noteID}/attachments`, { method: 'POST', body }); await refresh(); }
      finally { setBusy(false); }
    });
  });
  section.append(form);
}
