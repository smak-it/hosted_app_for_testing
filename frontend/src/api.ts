export async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(path, window.location.origin + "/"), {
    ...options,
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(
      result.detail || result.error || `Request failed (${response.status}). Please try again.`,
    );
  }
  return (response.status === 204 ? null : await response.json()) as T;
}
