import { InputError } from "../domain/errors";
export class Rukie {
  constructor(
    readonly url: string,
    readonly conversation: string,
  ) {}
  async send(input: Record<string, unknown>) {
    if (!this.url) throw new InputError("Rukie messaging is not configured.", 503);
    const response = await fetch(this.url.replace(/\/$/, "") + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        conversation_id: input.conversation_id || this.conversation,
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
