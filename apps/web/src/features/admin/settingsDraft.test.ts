import { describe, expect, it } from 'vitest';
import type { OrgSettings } from '@/types/api';
import { changedSettings } from './settingsDraft';
import type { SettingsDraft } from './types/settingsDraft';

const STORED: OrgSettings = {
  id: 1,
  orgName: 'Acme Corp',
  defaultCurrency: 'EUR',
  assetTagPrefix: 'AST',
  warrantyLeadDays: 60,
  logRetentionMonths: 12,
  emailWarrantyAlerts: true,
  emailReturnReminders: true,
  emailInvites: true,
  emailWeeklyDigest: false,
  mfaRequired: false,
  uploadQuotaMb: 2048,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const untouched: SettingsDraft = {
  orgName: 'Acme Corp',
  defaultCurrency: 'EUR',
  assetTagPrefix: 'AST',
  warrantyLeadDays: '60',
  logRetentionMonths: 12,
  emailWarrantyAlerts: true,
  emailReturnReminders: true,
  emailInvites: true,
  emailWeeklyDigest: false,
  mfaRequired: false,
  uploadQuotaMb: '2048',
};

const draft = (overrides: Partial<SettingsDraft> = {}): SettingsDraft => ({
  ...untouched,
  ...overrides,
});

describe('changedSettings', () => {
  it('is empty for a form nobody has touched', () => {
    expect(changedSettings(STORED, draft())).toEqual({});
  });

  it('sends only the fields that differ', () => {
    expect(changedSettings(STORED, draft({ orgName: 'Globex', emailWeeklyDigest: true }))).toEqual({
      orgName: 'Globex',
      emailWeeklyDigest: true,
    });
  });

  it('ignores whitespace a person did not mean to add', () => {
    expect(changedSettings(STORED, draft({ orgName: '  Acme Corp  ' }))).toEqual({});
  });

  it('uppercases the tag prefix before comparing, so "ast" is not a change', () => {
    expect(changedSettings(STORED, draft({ assetTagPrefix: 'ast' }))).toEqual({});
    expect(changedSettings(STORED, draft({ assetTagPrefix: 'inv' }))).toEqual({
      assetTagPrefix: 'INV',
    });
  });

  it('reads the lead time as a number', () => {
    expect(changedSettings(STORED, draft({ warrantyLeadDays: '45' }))).toEqual({
      warrantyLeadDays: 45,
    });
    expect(changedSettings(STORED, draft({ warrantyLeadDays: ' 60 ' }))).toEqual({});
  });

  it('still counts unparseable text as a change, so Save is not silently dead', () => {
    // The schema is what rejects it, in its own words, under the field.
    const patch = changedSettings(STORED, draft({ warrantyLeadDays: 'soon' }));
    expect(Object.keys(patch)).toEqual(['warrantyLeadDays']);
    expect(patch.warrantyLeadDays).toBe(-1);

    expect(changedSettings(STORED, draft({ warrantyLeadDays: '' })).warrantyLeadDays).toBe(-1);
  });

  it('treats Forever as a value, not an absence', () => {
    expect(changedSettings(STORED, draft({ logRetentionMonths: null }))).toEqual({
      logRetentionMonths: null,
    });
    expect(changedSettings({ ...STORED, logRetentionMonths: null }, draft())).toEqual({
      logRetentionMonths: 12,
    });
  });

  it('reads the storage quota as a number, and keeps bad text a change', () => {
    expect(changedSettings(STORED, draft({ uploadQuotaMb: '4096' }))).toEqual({
      uploadQuotaMb: 4096,
    });
    expect(changedSettings(STORED, draft({ uploadQuotaMb: ' 2048 ' }))).toEqual({});
    // Same rule as the lead time: the schema is what says what is wrong.
    expect(changedSettings(STORED, draft({ uploadQuotaMb: 'lots' })).uploadQuotaMb).toBe(-1);
    expect(changedSettings(STORED, draft({ uploadQuotaMb: '' })).uploadQuotaMb).toBe(-1);
  });

  it('takes each switch on its own', () => {
    expect(changedSettings(STORED, draft({ emailInvites: false }))).toEqual({
      emailInvites: false,
    });
  });
});
