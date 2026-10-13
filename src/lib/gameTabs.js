export const GAME_TABS = ['active', 'leaderboard', 'history', 'share', 'suggest', 'manage'];

export const GAME_TAB_LABELS = {
  active: 'Active Round',
  leaderboard: 'Season Leaderboard',
  history: 'Past Rounds',
  share: 'Share',
  suggest: 'Suggest a Question',
  manage: 'Manage Game',
};

export function resolveGameTab(value, isAdmin) {
  if (!GAME_TABS.includes(value)) return 'active';
  if (value === 'manage' && !isAdmin) return 'active';
  return value;
}
