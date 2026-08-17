import { describe, expect, it } from 'vitest';
import {
  LOG_RETENTION_LABELS,
  LOG_RETENTION_OPTIONS,
  MAX_WARRANTY_LEAD_DAYS,
  MIN_WARRANTY_LEAD_DAYS,
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

describe('the warranty lead time', () => {
  it('takes any whole number of days a workspace wants', () => {
    for (const days of [MIN_WARRANTY_LEAD_DAYS, 14, 45, 100, MAX_WARRANTY_LEAD_DAYS]) {
      expect(settingsPatchInput.parse({ warrantyLeadDays: days })).toEqual({
        warrantyLeadDays: days,
      });
    }
  });

  it('refuses a number that is not a lead time', () => {
    // Below a day there is no notice to give; beyond a year it is not a warning.
    expect(settingsPatchInput.safeParse({ warrantyLeadDays: 0 }).success).toBe(false);
    expect(settingsPatchInput.safeParse({ warrantyLeadDays: -30 }).success).toBe(false);
    expect(settingsPatchInput.safeParse({ warrantyLeadDays: 366 }).success).toBe(false);
    expect(settingsPatchInput.safeParse({ warrantyLeadDays: 30.5 }).success).toBe(false);
  });
});

describe('the retention list', () => {
  it('labels every retention period the control offers', () => {
    for (const months of LOG_RETENTION_OPTIONS) {
      expect(LOG_RETENTION_LABELS[`${months}`]).toBeTruthy();
    }
    expect(LOG_RETENTION_LABELS.null).toBe('Forever');
  });
});
