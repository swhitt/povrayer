// Unit tests for web/flags.js: the raw POV-Ray flags tokenizer behind the
// advanced controls field. Exhaustive so the module hits 100% without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFlags } from '../../web/flags.js';

test('empty / whitespace-only input yields no tokens', () => {
  assert.deepEqual(parseFlags(''), []);
  assert.deepEqual(parseFlags('   '), []);
  assert.deepEqual(parseFlags('\t \n'), []);
});

test('bare space-separated flags tokenize one per run', () => {
  assert.deepEqual(parseFlags('+A0.05 +AM2 +R4'), ['+A0.05', '+AM2', '+R4']);
});

test('runs of mixed whitespace collapse', () => {
  assert.deepEqual(parseFlags('  +A0.1\t\t+J0.5\n+R3  '), ['+A0.1', '+J0.5', '+R3']);
});

test('double-quoted runs keep inner spaces and drop the quotes', () => {
  assert.deepEqual(parseFlags('+A0.1 "Output_File_Name=my render"'), [
    '+A0.1',
    'Output_File_Name=my render',
  ]);
});

test('single-quoted runs keep inner spaces and drop the quotes', () => {
  assert.deepEqual(parseFlags("'a b' +Q9"), ['a b', '+Q9']);
});

test('an empty quoted token is preserved as an empty string', () => {
  assert.deepEqual(parseFlags('"" +A0.3'), ['', '+A0.3']);
});
