import type { Attachment } from "../../shared/notes";
import { MAX_FILE_BYTES } from "../../shared/notes";
import { request } from "./api";
import { element } from "./dom";

export function showAttachments(items: Attachment[], remove: (item: Attachment) => void) {
  element("#attachment-count").textContent = String(items.length);
  element("#files-status").textContent = items.length
    ? ""
    : "No files attached. Add an image, document or other file.";
  const rows = items.map((item) => {
    const row = document.createElement("div");
    row.className = "file-row";
    const info = document.createElement("div");
    info.className = "file-info";
    const link = document.createElement("a");
    link.href = `/api/attachments/${encodeURIComponent(item.id)}`;
    link.textContent = item.filename;
    link.download = item.filename;
    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent =
      item.size < 1024
        ? `${item.size} bytes`
        : item.size < 1024 * 1024
          ? `${Math.ceil(item.size / 1024)} KB`
          : `${(item.size / 1024 / 1024).toFixed(1)} MB`;
    info.append(link, size);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button quiet small danger";
    button.textContent = "Remove";
    button.setAttribute("aria-label", `Remove ${item.filename}`);
    button.addEventListener("click", () => remove(item));
    row.append(info, button);
    return row;
  });
  element("#files").replaceChildren(...rows);
}

export async function uploadAttachment(noteID: number, file: File) {
  if (file.size > MAX_FILE_BYTES) throw new Error("Choose a file of at most 32 MiB.");
  const body = new FormData();
  body.append("file", file);
  await request(`api/notes/${noteID}/attachments`, { method: "POST", body });
}
