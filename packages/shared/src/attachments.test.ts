import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_EXTENSIONS,
  MAX_UPLOAD_QUOTA_MB,
  MIN_UPLOAD_QUOTA_MB,
  isAllowedAttachment,
} from './attachments.js';

describe('the attachment allowlist', () => {
  it.each([
    ['pdf', true],
    ['png', true],
    ['jpeg', true],
    ['heic', true],
    ['docx', true],
    ['odp', true],
    ['csv', true],
    ['log', true],
    ['7z', true],
    ['gz', true],
    // A spreadsheet named on a Mac and one named on Windows are the same file.
    ['PDF', true],
    ['JPG', true],
    // SVG is a scriptable format, and deliberately absent.
    ['svg', false],
    ['exe', false],
    ['html', false],
    ['js', false],
    // A file with no extension at all, and one that is only a dot.
    ['', false],
    ['.pdf', false],
  ])('answers %s with %s', (extension, allowed) => {
    expect(isAllowedAttachment(extension)).toBe(allowed);
  });

  it('lists every family the policy names, and nothing scriptable', () => {
    expect(ATTACHMENT_EXTENSIONS).toContain('webp');
    expect(ATTACHMENT_EXTENSIONS).toContain('xlsx');
    expect(ATTACHMENT_EXTENSIONS).toContain('md');
    expect(ATTACHMENT_EXTENSIONS).toContain('zip');
    expect(ATTACHMENT_EXTENSIONS).not.toContain('svg');
    // Every entry is a bare, lowercase extension — the file input's accept
    // string puts the dots back, and the server compares what it sanitized.
    for (const extension of ATTACHMENT_EXTENSIONS) {
      expect(extension).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('offers the same list to a file input, dotted and comma-separated', () => {
    expect(ATTACHMENT_ACCEPT.split(',')).toEqual(
      ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`),
    );
  });
});

describe('the storage quota bounds', () => {
  it('runs from a hundred megabytes to a hundred gigabytes', () => {
    expect(MIN_UPLOAD_QUOTA_MB).toBe(100);
    expect(MAX_UPLOAD_QUOTA_MB).toBe(100 * 1024);
  });
});
