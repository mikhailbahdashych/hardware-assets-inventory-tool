/**
 * The Clipboard API is unavailable outside a secure context, which a
 * self-hosted instance on plain http is — so this can genuinely fail, and
 * every caller shows the text on screen as well. Copying is the convenience;
 * the readable field is the delivery.
 */
export async function copyText(value: string): Promise<boolean> {
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
