import dayjs from 'dayjs';

export function getUrgencyTier(expiresAt, now = dayjs()) {
  const diff = dayjs(expiresAt).diff(now, 'second');
  if (diff <= 0) return 'closed';
  if (diff <= 3600) return 'danger';
  if (diff <= 6 * 3600) return 'warning';
  return 'normal';
}

export function formatTimeRemaining(expiresAt, now = dayjs()) {
  const diff = dayjs(expiresAt).diff(now, 'minute');
  if (diff <= 0) return 'closed';
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
}

export function urgencyPillClass(tier) {
  if (tier === 'danger') return 'pill pill-danger';
  if (tier === 'warning') return 'pill pill-warning';
  return 'pill';
}
