-- Run this only in the production Hivemind project. The callback reaches the
-- deployed app, which makes qualifying PostgREST reads without exposing a
-- Supabase key in this job.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname = 'hivemind-keepalive';

select cron.schedule(
  'hivemind-keepalive',
  '23 1 * * *',
  $$select net.http_get(
    url := 'https://hivemind-ev7a.onrender.com/api/keepalive',
    timeout_milliseconds := 90000
  );$$
);
