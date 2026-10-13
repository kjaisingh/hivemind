import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { getUrgencyTier, urgencyPillClass } from '../../lib/countdown';

export default function Countdown({ expiresAt, onExpire }) {
  const [label, setLabel] = useState(null);
  const [tier, setTier] = useState('normal');
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;
    function tick() {
      const diff = dayjs(expiresAt).diff(dayjs(), 'second');
      setTier(getUrgencyTier(expiresAt));
      if (diff <= 0) {
        setLabel('Round closed');
        if (!expiredRef.current) {
          expiredRef.current = true;
          onExpire?.();
        }
        return true;
      }
      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;
      const parts = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (hours > 0 || minutes > 0) parts.push(`${minutes}m`);
      parts.push(`${seconds}s`);
      setLabel(`${parts.join(' ')} left`);
      return false;
    }

    const alreadyExpired = tick();
    if (alreadyExpired) return undefined;
    const timer = setInterval(() => {
      if (tick()) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);

  return <p className={urgencyPillClass(tier)} role="timer" aria-live={tier === 'closed' ? 'polite' : 'off'}>{label ?? 'Loading time remaining...'}</p>;
}
