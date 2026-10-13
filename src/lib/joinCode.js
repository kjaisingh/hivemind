const GAME_CODE_CHARACTERS = /[^A-HJ-NP-Z2-9]/g;

export function formatJoinCode(value) {
  const compact = value.toUpperCase().replace(GAME_CODE_CHARACTERS, '').slice(0, 6);
  return compact.length > 3 ? `${compact.slice(0, 3)}-${compact.slice(3)}` : compact;
}
