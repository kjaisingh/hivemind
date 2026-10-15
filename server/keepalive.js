export const KEEPALIVE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const QUERY_COUNT = 3;

export function createKeepaliveProbe(
  supabase,
  { cooldownMs = KEEPALIVE_COOLDOWN_MS, now = () => Date.now() } = {},
) {
  let lastSuccessAt = null;
  let inFlight = null;

  async function queryDatabase() {
    for (let index = 0; index < QUERY_COUNT; index += 1) {
      const { error } = await supabase.from('User').select('id').limit(1);
      if (error) {
        const keepaliveError = new Error(error.message);
        keepaliveError.code = error.code;
        throw keepaliveError;
      }
    }

    lastSuccessAt = now();
    return { cached: false, checkedAt: new Date(lastSuccessAt).toISOString() };
  }

  return async function runKeepalive() {
    const currentTime = now();
    if (lastSuccessAt !== null && currentTime - lastSuccessAt < cooldownMs) {
      return { cached: true, checkedAt: new Date(lastSuccessAt).toISOString() };
    }

    if (!inFlight) {
      inFlight = queryDatabase().finally(() => {
        inFlight = null;
      });
    }

    return inFlight;
  };
}
