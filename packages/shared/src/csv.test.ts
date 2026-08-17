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
