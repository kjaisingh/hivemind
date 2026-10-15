import { pathToFileURL } from 'node:url';

const zone = 'America/New_York';
const graceMinutes = 30;
const firstCycle = '2026-10-15 18:00';
const finalCycle = '2026-10-25 18:00';
const issueNumber = 20;
const workflowFile = 'monitor-supabase-keepalives.yml';

export const jobs = [
  { name: 'Jeopardy', id: 8653167, minute: 0, env: 'CRON_BADGE_JEOPARDY' },
  { name: 'Hivemind', id: 8653486, minute: 5, env: 'CRON_BADGE_HIVEMIND' },
  { name: 'Trigger', id: 8653490, minute: 10, env: 'CRON_BADGE_TRIGGER' },
  { name: 'Atlantis', id: 8653494, minute: 15, env: 'CRON_BADGE_ATLANTIS' },
];

const localFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: zone,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function localParts(date) {
  return Object.fromEntries(localFormatter.formatToParts(date)
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
}

const pad = (value) => String(value).padStart(2, '0');

export function expectedCycle(now, minute = 0) {
  const parts = localParts(new Date(now.getTime() - graceMinutes * 60_000));
  let hour = Math.floor(parts.hour / 6) * 6;
  let day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (parts.hour === hour && parts.minute < minute) {
    hour -= 6;
    if (hour < 0) {
      hour = 18;
      day = new Date(day.getTime() - 86_400_000);
    }
  }
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())} ${pad(hour)}:${pad(minute)}`;
}

export function parseBadge(svg) {
  const labels = [...svg.matchAll(/<tspan\b[^>]*>([^<]*)<\/tspan>/g)].map((match) => match[1].trim());
  if (!svg.includes('<svg') || labels.length === 0) throw new Error('Badge SVG has an unexpected format');
  const label = labels.at(-1);
  const success = /^success \((\d{1,2}:\d{2})\)$/i.exec(label);
  if (success) return { status: 'success', time: success[1].padStart(5, '0') };
  if (/^not run yet$/i.test(label)) return { status: 'not run yet' };
  return { status: 'failure or unknown format' };
}

async function fetchBadge(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return parseBadge(await response.text());
    } catch {
      // A short retry covers transient badge service or network errors.
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { status: 'badge unavailable' };
}

export function statusForJob(job, badge, now) {
  const expected = expectedCycle(now, job.minute);
  const current = expectedCycle(new Date(now.getTime() + graceMinutes * 60_000), job.minute);
  const allowed = new Set([expected.slice(-5)]);
  if (current > expected) allowed.add(current.slice(-5));
  const ok = badge.status === 'success' && allowed.has(badge.time);
  return { ok, text: ok ? `✅ ${badge.time}` : `❌ ${badge.status}${badge.time ? ` (${badge.time})` : ''}` };
}

async function github(path, method = 'GET', data) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub API ${method} failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}

export function updateBody(body, cycle, cells) {
  const marker = '<!-- keepalive-monitor:end -->';
  if (!body.includes(marker)) throw new Error('Tracking issue marker is missing');
  const previous = /<!-- keepalive-monitor:checkpoint ([^ ]+) -->/.exec(body)?.[1];
  const wasAnomaly = /<!-- keepalive-monitor:active true -->/.test(body);
  let gapCount = 0;
  if (previous) {
    const hours = (Date.parse(`${cycle.replace(' ', 'T')}:00-04:00`) - Date.parse(previous)) / 3_600_000;
    if (hours > 6) gapCount = Math.round(hours / 6) - 1;
    if (hours < 0) gapCount = -1;
  } else if (cycle > firstCycle) {
    const hours = (Date.parse(`${cycle.replace(' ', 'T')}:00-04:00`) - Date.parse(`${firstCycle.replace(' ', 'T')}:00-04:00`)) / 3_600_000;
    gapCount = Math.round(hours / 6);
  }
  const anomaly = cells.some(({ ok }) => !ok) || gapCount !== 0;
  const monitor = gapCount > 0 ? `❌ missed ${gapCount} monitor cycle(s)`
    : gapCount < 0 ? '❌ out-of-order monitor cycle' : '✅ on schedule';
  const row = `| ${cycle} | ${cells.map(({ text }) => text).join(' | ')} | ${monitor} |`;
  const rows = body.match(/^\| 2026-\d{2}-\d{2} \d{2}:00 \|.*$/gm) ?? [];
  const byCycle = new Map(rows.map((value) => [/^\| ([^|]+) \|/.exec(value)?.[1], value]));
  byCycle.set(cycle, row);
  const clean = body
    .replace(/^\| 2026-\d{2}-\d{2} \d{2}:00 \|.*\n?/gm, '')
    .replace(/<!-- keepalive-monitor:(?:checkpoint|active) [^>]+ -->\n?/g, '');
  const checkpoint = previous && previous > `${cycle.replace(' ', 'T')}:00-04:00`
    ? previous : `${cycle.replace(' ', 'T')}:00-04:00`;
  const metadata = `<!-- keepalive-monitor:checkpoint ${checkpoint} -->\n<!-- keepalive-monitor:active ${anomaly} -->`;
  const nextBody = clean.replace(marker, `${[...byCycle.values()].sort().join('\n')}\n${metadata}\n${marker}`);
  return { nextBody, anomaly, wasAnomaly, gapCount, monitor };
}

async function run() {
  const baseline = process.argv.includes('--baseline');
  const now = new Date();
  const cycle = expectedCycle(now);
  if (!baseline && cycle < firstCycle) throw new Error('First monitored cycle has not started; use --baseline');
  if (!baseline && (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY)) {
    throw new Error('GitHub Actions context is missing');
  }
  if (!baseline && cycle > finalCycle) {
    const issue = await github(`/issues/${issueNumber}`);
    if (!issue.body.includes(`<!-- keepalive-monitor:checkpoint ${finalCycle.replace(' ', 'T')}:00-04:00 -->`)) {
      await github(`/issues/${issueNumber}/comments`, 'POST', {
        body: 'The final scheduled monitoring cycle was missed. Check cron-job.org execution history for October 25 at 18:00 ET.',
      });
      process.exitCode = 1;
    }
    await github(`/actions/workflows/${workflowFile}/disable`, 'PUT');
    console.log('Monitoring window ended; workflow disabled.');
    return;
  }
  const badgeResults = await Promise.all(jobs.map(async (job) => {
    const url = process.env[job.env];
    if (!url?.startsWith(`https://api.cron-job.org/jobs/${job.id}/`)) throw new Error(`${job.env} is missing or invalid`);
    return { job, badge: await fetchBadge(url) };
  }));
  if (baseline) {
    for (const { job, badge } of badgeResults) console.log(`${job.name}: ${badge.status}${badge.time ? ` (${badge.time})` : ''}`);
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
      const issue = await github(`/issues/${issueNumber}`);
      const time = localFormatter.format(now);
      const summary = badgeResults.map(({ job, badge }) => `${job.name} ${badge.status}${badge.time ? ` ${badge.time}` : ''}`).join('; ');
      const body = issue.body.replace(/^\*\*Baseline:.*\n\n/m, '');
      await github(`/issues/${issueNumber}`, 'PATCH', {
        body: body.replace('| Scheduled cycle (ET)', `**Baseline: ${time} ET:** ${summary}.\n\n| Scheduled cycle (ET)`),
      });
    }
    if (badgeResults.some(({ badge }) => badge.status === 'badge unavailable')) process.exitCode = 1;
    return;
  }

  const issue = await github(`/issues/${issueNumber}`);
  const cells = badgeResults.map(({ job, badge }) => statusForJob(job, badge, now));
  const { nextBody, anomaly, wasAnomaly, gapCount } = updateBody(issue.body, cycle, cells);
  if (anomaly && !wasAnomaly) {
    await github(`/issues/${issueNumber}/comments`, 'POST', {
      body: `Keepalive monitor detected a problem for ${cycle} ET. ${cells.map(({ text }, i) => `${jobs[i].name}: ${text}`).join('; ')}${gapCount ? `; missed monitor cycles: ${gapCount}` : ''}. See the issue table and cron-job.org history.`,
    });
  } else if (!anomaly && wasAnomaly) {
    await github(`/issues/${issueNumber}/comments`, 'POST', { body: `The ${cycle} ET check passed for all four jobs after the prior anomaly.` });
  }
  await github(`/issues/${issueNumber}`, 'PATCH', { body: nextBody });
  console.log(`${cycle} ET: ${cells.map(({ text }) => text).join(' | ')} | monitor gap: ${gapCount}`);

  if (cycle >= finalCycle) {
    await github(`/issues/${issueNumber}/comments`, 'POST', {
      body: `Monitoring window ended after the ${cycle} ET check. Review the table and cron-job.org response history for the final assessment.`,
    });
    await github(`/actions/workflows/${workflowFile}/disable`, 'PUT');
    console.log('Monitoring workflow disabled after final cycle.');
  }
  if (anomaly) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
