import { element } from "./dom";
for (const name of ["messaging", "testing"]) {
  const dialog = element<HTMLDialogElement>(`#${name}-dialog`);
  element(`#open-${name}`).addEventListener("click", () => {
    dialog.showModal();
    if (name === "messaging") element<HTMLTextAreaElement>("#message").focus();
  });
  element("[data-close]", dialog).addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      dialog.close();
  });
}
