function csvCell(value) {
  const text = String(value ?? '');
  const safeText = /^[\s]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function buildAnswerSummaryCsv(questions) {
  const rows = [['Question', 'Answer', 'Responses', 'Percentage']];

  for (const question of questions) {
    for (const stat of question.stats) {
      rows.push([question.prompt, stat.displayAnswer, stat.count, stat.percentage.toFixed(1)]);
    }
  }

  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
