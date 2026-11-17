import { InputError } from "../domain/errors";
export class Rukie {
  constructor(readonly url: string) {}
  async sendReport(input: Record<string, unknown>) {
    if (!this.url) throw new InputError("Rukie messaging is not configured.", 503);
    const response = await fetch(this.url.replace(/\/$/, "") + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: input.request_id,
        content: input.content,
        attachments: input.attachments,
        room_alias: "reports",
      }),
      signal: AbortSignal.timeout(50000),
      redirect: "error",
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
