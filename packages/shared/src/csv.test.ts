import { describe, expect, it } from 'vitest';
import { csvField, toCsv } from './csv.js';

describe('csvField', () => {
  it('leaves ordinary text alone', () => {
    expect(csvField('Maya Lindqvist')).toBe('Maya Lindqvist');
    expect(csvField('')).toBe('');
  });

  it('quotes anything that would otherwise tear a row apart', () => {
    expect(csvField('Lindqvist, Maya')).toBe('"Lindqvist, Maya"');
    expect(csvField('MacBook Pro 14"')).toBe('"MacBook Pro 14"""');
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
  });
});

describe('toCsv', () => {
  it('writes a header row and ends the file with a newline', () => {
    expect(toCsv(['Time', 'Event'], [['2026-08-17T09:00:00.000Z', 'Signed in']])).toBe(
      'Time,Event\n2026-08-17T09:00:00.000Z,Signed in\n',
    );
  });

  it('writes just the header when there is nothing to export', () => {
    expect(toCsv(['Time', 'Event'], [])).toBe('Time,Event\n');
  });
});

describe('spreadsheet formula neutralisation', () => {
  it('stops a cell being read as a formula when somebody opens the file', () => {
    // Excel, LibreOffice and Sheets all evaluate a cell starting with one of
    // these. The apostrophe is the convention for "this is text".
    for (const payload of ['=1+1', '+1', '-1', '@SUM(A1)', "=cmd|'/c calc'!A1", '\tleading tab']) {
      expect(csvField(payload), payload).toBe(`'${payload}`);
    }
  });

  it('neutralises before quoting, so quotes cannot hide the payload', () => {
    // A comma forces quoting; the parser strips those quotes before
    // evaluating, so the apostrophe has to be inside them.
    expect(csvField('=HYPERLINK("http://x","Payroll")')).toBe(
      '"\'=HYPERLINK(""http://x"",""Payroll"")"',
    );
  });

  it('leaves ordinary values exactly as they were', () => {
    for (const value of ['MacBook Pro 14"', 'Maya Lindqvist', 'AST-0001', '2026-08-17', '']) {
      const written = csvField(value);
      expect(written.startsWith("'"), value).toBe(false);
    }
  });
});
