import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePrintContent } from '../src/components/printFormat.js';

test('print layout turns hyphen and bullet rows into semantic list items', () => {
  assert.deepEqual(parsePrintContent('- Diagnosis A\n• Diagnosis B'), [
    { type: 'list', items: ['Diagnosis A', 'Diagnosis B'] },
  ]);
});

test('print layout preserves narrative paragraphs around lists', () => {
  assert.deepEqual(parsePrintContent('Course summary\n- Treatment A\n- Treatment B\n\nDischarge status'), [
    { type: 'paragraph', text: 'Course summary' },
    { type: 'list', items: ['Treatment A', 'Treatment B'] },
    { type: 'paragraph', text: 'Discharge status' },
  ]);
});
