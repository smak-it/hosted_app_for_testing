import type { AdminOverview, NotesCounts, SampleNoteResult } from "../../shared/admin";
import { request, RequestError } from "./api";
import { element, errorText } from "./dom";

const overview = element("#overview");
const userID = element("#user-id");
const copy = element<HTMLButtonElement>("#copy");
const create = element<HTMLButtonElement>("#create-sample");
const refresh = element<HTMLButtonElement>("#refresh");
const status = element("#status");
const error = element("#error");
let identity: string | null = null;

function renderIdentity(id: string | null) {
  identity = id;
  userID.textContent = id;
  userID.hidden = copy.hidden = id === null;
  element("#anonymous").hidden = id !== null;
  element("#sample-auth").hidden = id !== null;
}

function renderCounts(counts: NotesCounts) {
  element("#notes").textContent = String(counts.note_count);
  element("#attachments").textContent = String(counts.attachment_count);
}

async function run(work: () => Promise<void>) {
  refresh.disabled = true;
  create.disabled = true;
  error.hidden = true;
  status.textContent = "";
  try {
    await work();
  } catch (err) {
    status.textContent = "";
    if (err instanceof RequestError && (err.status === 401 || err.status === 403)) {
      renderIdentity(null);
      error.textContent = "Reopen this endpoint to refresh your Rukie identity.";
    } else {
      error.textContent = errorText(err);
    }
    error.hidden = false;
  } finally {
    refresh.disabled = false;
    create.disabled = identity === null;
  }
}

async function load() {
  await run(async () => {
    status.textContent = "Loading admin overview…";
    const data = await request<AdminOverview>("/api/admin");
    renderIdentity(data.rukie_user_id);
    element("#version").textContent = data.version;
    renderCounts(data);
    overview.hidden = false;
    status.textContent = "";
  });
}

refresh.addEventListener("click", load);
copy.addEventListener("click", async () => {
  if (!identity) return;
  try {
    await navigator.clipboard.writeText(identity);
    status.textContent = "Rukie user ID copied.";
  } catch {
    status.textContent = "Select the Rukie user ID to copy it.";
  }
});
create.addEventListener("click", async () => {
  create.setAttribute("aria-busy", "true");
  await run(async () => {
    const result = await request<SampleNoteResult>("/api/admin/sample-note", { method: "POST" });
    renderCounts(result);
    status.textContent = `Sample note #${result.note_id} created.`;
  });
  create.removeAttribute("aria-busy");
});
void load();
