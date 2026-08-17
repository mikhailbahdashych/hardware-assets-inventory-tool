import { describe, expect, it } from 'vitest';
import {
  LOG_RETENTION_LABELS,
  LOG_RETENTION_OPTIONS,
  WARRANTY_LEAD_DAY_LABELS,
  WARRANTY_LEAD_DAY_OPTIONS,
} from '../enums.js';
import { settingsPatchInput } from './settings.js';

describe('settingsPatchInput', () => {
  it('leaves absent fields alone', () => {
    expect(settingsPatchInput.parse({})).toEqual({});
  });

  it('accepts the organization card as the form submits it', () => {
    expect(
      settingsPatchInput.parse({
        orgName: '  Acme Corp  ',
        defaultCurrency: 'USD',
        assetTagPrefix: 'ast',
        warrantyLeadDays: 30,
      }),
    ).toEqual({
      orgName: 'Acme Corp',
      defaultCurrency: 'USD',
      // The prefix is uppercased here so AST-0224 and ast-0224 cannot both exist.
      assetTagPrefix: 'AST',
      warrantyLeadDays: 30,
    });
  });

  it('rejects a prefix that would not survive being part of a tag', () => {
    expect(settingsPatchInput.safeParse({ assetTagPrefix: 'A-1' }).success).toBe(false);
    expect(settingsPatchInput.safeParse({ assetTagPrefix: '' }).success).toBe(false);
  });

  it('treats forever as a null retention, not a missing one', () => {
    expect(settingsPatchInput.parse({ logRetentionMonths: null })).toEqual({
      logRetentionMonths: null,
    });
    expect(settingsPatchInput.parse({ logRetentionMonths: 24 })).toEqual({
      logRetentionMonths: 24,
    });
    expect(settingsPatchInput.safeParse({ logRetentionMonths: 7 }).success).toBe(false);
  });

  it('takes each email toggle on its own', () => {
    expect(settingsPatchInput.parse({ emailWeeklyDigest: true })).toEqual({
      emailWeeklyDigest: true,
    });
  });
});

describe('the settings option lists', () => {
  it('labels every warranty lead time and retention period the select offers', () => {
    for (const days of WARRANTY_LEAD_DAY_OPTIONS) {
      expect(WARRANTY_LEAD_DAY_LABELS[days]).toMatch(/before expiry$/);
    }
    for (const months of LOG_RETENTION_OPTIONS) {
      expect(LOG_RETENTION_LABELS[`${months}`]).toBeTruthy();
    }
    expect(LOG_RETENTION_LABELS.null).toBe('Forever');
  });
});
