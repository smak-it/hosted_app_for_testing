import { MAX_FILE_BYTES } from "../../shared/notes";
import { InputError } from "../domain/errors";

export class BlobStorage {
  constructor(
    private endpoint: string,
    private token: string,
  ) {}
  async request(
    method: string,
    key: string,
    body?: Uint8Array,
    signal = AbortSignal.timeout(15000),
  ) {
    const url = this.endpoint.replace(/\/$/, "") + "/" + encodeURIComponent(key);
    const response = await fetch(url, {
      method,
      body: body as BodyInit,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/octet-stream",
      },
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Blob service returned ${response.status}`);
    }
    return response;
  }
  async put(key: string, body: Uint8Array) {
    const response = await this.request("PUT", key, body);
    await response.body?.cancel();
  }
  async remove(key: string) {
    try {
      const response = await this.request("DELETE", key);
      await response.body?.cancel();
    } catch (error) {
      console.warn("Unreferenced attachment retained until app deletion", key, error);
    }
  }
  // Stream inspection bounds memory even for the largest supported attachment.
  async describe(key: string, signal = AbortSignal.timeout(15000)) {
    const response = await this.request("GET", key, undefined, signal);
    let size = 0;
    const prefix = new Uint8Array(512);
    let length = 0;
    try {
      for await (const chunk of response.body!) {
        size += chunk.length;
        if (size > MAX_FILE_BYTES) throw new InputError("Files must contain 1 byte to 32 MiB");
        const part = chunk.subarray(0, 512 - length);
        prefix.set(part, length);
        length += part.length;
      }
    } finally {
      if (!response.body?.locked) await response.body?.cancel().catch(() => {});
    }
    if (!size) throw new InputError("Files must contain 1 byte to 32 MiB");
    return { size, content_type: contentType(prefix.subarray(0, length)) };
  }
}
export function contentType(bytes: Uint8Array) {
  if (bytes[0] === 137 && new TextDecoder().decode(bytes.subarray(1, 4)) === "PNG")
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  const text = new TextDecoder().decode(bytes.subarray(0, 512));
  if (text.startsWith("%PDF-")) return "application/pdf";
  if (text.startsWith("GIF87a") || text.startsWith("GIF89a")) return "image/gif";
  if (
    [...text].every((char) => {
      const code = char.charCodeAt(0);
      return code !== 65533 && (code >= 32 || [9, 10, 12, 13].includes(code));
    })
  )
    return "text/plain; charset=utf-8";
  return "application/octet-stream";
}
