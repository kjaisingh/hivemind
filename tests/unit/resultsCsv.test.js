import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnswerSummaryCsv } from '../../src/lib/resultsCsv.js';

test('answer summary CSV preserves commas and quotes while neutralizing spreadsheet formulas', () => {
  const csv = buildAnswerSummaryCsv([
    {
      prompt: 'Name a "snack", please',
      stats: [
        { displayAnswer: 'taco, crispy', count: 2, percentage: 66.666 },
        { displayAnswer: '=IMPORTXML("https://example.test")', count: 1, percentage: 33.333 },
      ],
    },
  ]);

  assert.equal(
    csv,
    '"Question","Answer","Responses","Percentage"\r\n'
      + '"Name a ""snack"", please","taco, crispy","2","66.7"\r\n'
      + '"Name a ""snack"", please","\'=IMPORTXML(""https://example.test"")","1","33.3"\r\n',
  );
});
