import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { getUrgencyTier, urgencyPillClass } from '../../lib/countdown';

export default function Countdown({ expiresAt, onExpire }) {
  const [label, setLabel] = useState(null);
  const [tier, setTier] = useState('normal');

  useEffect(() => {
    function tick() {
      const diff = dayjs(expiresAt).diff(dayjs(), 'second');
      setTier(getUrgencyTier(expiresAt));
      if (diff <= 0) {
        setLabel('Round closed');
        onExpire?.();
        return;
      }
      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;
      const parts = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (hours > 0 || minutes > 0) parts.push(`${minutes}m`);
      parts.push(`${seconds}s`);
      setLabel(`${parts.join(' ')} left`);
    }

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);

  return <p className={urgencyPillClass(tier)} aria-live="polite">{label ?? 'Loading time remaining...'}</p>;
}
