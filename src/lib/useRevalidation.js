import { useEffect } from 'react';

export function useRevalidation(refresh, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    let inFlight = false;
    const revalidate = async () => {
      if (document.visibilityState !== 'visible' || inFlight) return;
      inFlight = true;
      try {
        await refresh();
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(revalidate, 30_000);
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [refresh, enabled]);
}
