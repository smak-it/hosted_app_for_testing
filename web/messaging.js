const form = document.querySelector('#messaging-form');
const status = document.querySelector('#messaging-status');
let pending = null;
fetch('/api/messaging').then(response => response.json()).then(config => {
  document.querySelector('#conversation').value = config.conversation_id;
  if (!config.enabled) status.textContent = 'Messaging is available when deployed with Rukie messaging access.';
}).catch(() => { status.textContent = 'Messaging configuration unavailable.'; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  const fields = new FormData(form);
  const blobKey = String(fields.get('blob-key')).trim();
  const message = {
    conversation_id: String(fields.get('conversation')).trim(),
    content: String(fields.get('message')),
    attachments: blobKey ? [{blob_key: blobKey, name: String(fields.get('attachment-name')).trim()}] : [],
  };
  const serialized = JSON.stringify(message);
  if (!pending || pending.serialized !== serialized) pending = {serialized, requestID: crypto.randomUUID()};
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = 'Sending…';
  try {
    const response = await fetch('/api/messaging', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({...message, request_id: pending.requestID}), signal: AbortSignal.timeout(55000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || result.error || `Request failed (${response.status}).`);
    status.textContent = 'Message delivered to Rukie.';
  } catch (error) { status.textContent = `${error.message} Retry with unchanged fields to avoid a duplicate.`; }
  finally {button.disabled = false;}
});
