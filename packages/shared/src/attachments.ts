// The attachment policy: what a workspace may upload, and how much of it. Both
// halves live here because both are answered twice — the server refuses what
// the list does not name, and the file input offers exactly the same list.

/**
 * The file types an attachment may be, as bare lowercase extensions.
 *
 * Images, PDFs, office documents, plain text and archives — the paperwork an
 * inventory actually collects. **SVG is deliberately absent**: it is a
 * scriptable format, and while the forced-download headers make it safe to
 * _serve_, there is no reason to invite it onto the volume in the first place.
 *
 * Adding one is a code-only change, like every other slug list here: the
 * database stores the filename as a label and nothing constrains it.
 */
export const ATTACHMENT_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'heic',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'txt',
  'csv',
  'md',
  'log',
  'zip',
  '7z',
  'tar',
  'gz',
] as const;

/** Derived from the array above, which is the list itself. */
export type AttachmentExtension = (typeof ATTACHMENT_EXTENSIONS)[number];

/**
 * Whether the policy accepts a file with this extension — **without its dot**,
 * which is the form the server holds after sanitizing what it was sent.
 * Case-insensitive: a camera writes `IMG_0042.HEIC` and a Mac writes `.heic`,
 * and they are the same kind of file.
 */
export function isAllowedAttachment(extension: string): extension is AttachmentExtension {
  const normalized = extension.toLowerCase();
  return (ATTACHMENT_EXTENSIONS as readonly string[]).includes(normalized);
}

/**
 * The same list as a file input's `accept` attribute, so the browser's picker
 * greys out what the server would refuse. Derived rather than written down:
 * two spellings of one policy would eventually be two policies.
 */
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`).join(
  ',',
);

/**
 * What a workspace's attachment storage may be set to. A floor of 100 MB
 * because ten files at the 10 MB per-file cap is the smallest quota that is
 * not simply "off"; a ceiling of 100 GB because the number is typed into a
 * form and a typo should not promise a volume nobody has.
 */
export const MIN_UPLOAD_QUOTA_MB = 100;
export const MAX_UPLOAD_QUOTA_MB = 100 * 1024;
