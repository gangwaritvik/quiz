import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCsv, stripHeader } from '@/lib/csv';

describe('parseCsv', () => {
  test('parses simple rows and trims cells', () => {
    assert.deepEqual(parseCsv('a, b ,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
  });
  test('keeps commas inside quoted fields', () => {
    assert.deepEqual(parseCsv('"Doe, Jane",x'), [['Doe, Jane', 'x']]);
  });
  test('keeps newlines (LF and CRLF) inside quoted fields', () => {
    assert.deepEqual(parseCsv('"line1\nline2",b\n"c\r\nd",e'), [['line1\nline2', 'b'], ['c\r\nd', 'e']]);
  });
  test('unescapes doubled quotes', () => {
    assert.deepEqual(parseCsv('"say ""hi""",b'), [['say "hi"', 'b']]);
  });
  test('strips a leading BOM so the first header matches', () => {
    assert.deepEqual(parseCsv('﻿name,email\nA,a@x.edu'), [['name', 'email'], ['A', 'a@x.edu']]);
  });
  test('handles CRLF and bare CR line endings without phantom rows', () => {
    assert.deepEqual(parseCsv('a,b\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']]);
    assert.deepEqual(parseCsv('a,b\rc,d'), [['a', 'b'], ['c', 'd']]);
  });
  test('skips blank and all-empty rows but keeps rows with some data', () => {
    assert.deepEqual(parseCsv('a,b\n\n , \n,x\n\n'), [['a', 'b'], ['', 'x']]);
  });
  test('empty input yields no rows', () => {
    assert.deepEqual(parseCsv(''), []);
    assert.deepEqual(parseCsv('\n\r\n'), []);
  });
  test('preserves empty middle cells', () => {
    assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]);
  });
  test('an unterminated quote swallows the rest of the input instead of throwing', () => {
    assert.deepEqual(parseCsv('a,"b,c\nd'), [['a', 'b,c\nd']]);
  });
  test('quote in the middle of an unquoted cell starts quoted mode (lenient)', () => {
    assert.deepEqual(parseCsv('ab"c,d"e,f'), [['abc,de', 'f']]);
  });
});

describe('stripHeader', () => {
  const rows = [['Name', 'Email'], ['A', 'a@x.edu']];
  test('drops the header row when the first cell matches, case-insensitively', () => {
    assert.deepEqual(stripHeader(rows, ['name']), [['A', 'a@x.edu']]);
  });
  test('keeps the rows when no header matches', () => {
    assert.deepEqual(stripHeader(rows, ['question']), rows);
  });
  test('tolerates empty input', () => {
    assert.deepEqual(stripHeader([], ['name']), []);
  });
});
