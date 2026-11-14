export const INBOX_EXTENSIONS = [".txt", ".md", ".csv", ".json", ".oem", ".xml", ".tif", ".tiff", ".pdf", ".bsp"] as const;

export function inboxExtensionError(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  return (INBOX_EXTENSIONS as readonly string[]).includes(ext) ? null : `${filename}: the inbox accepts ${INBOX_EXTENSIONS.join(" ")} only.`;
}
