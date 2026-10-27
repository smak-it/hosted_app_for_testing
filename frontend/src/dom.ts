export function element<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
