// Le podium des mascottes (podium.ts) : la logique pure, testée dans
// tests/front/podium.test.ts.

/** Les places de chaque marche, de haut en bas. */
const ROWS = [1, 3, 5, 6];

/** Les rangées pour `n` mascottes : 1, 3, 5, 6, puis des rangées de 6. */
export function podiumRows(n: number): number[] {
  const rows: number[] = [];
  let left = n;
  for (let i = 0; left > 0; i++) {
    const size = Math.min(left, ROWS[i] ?? ROWS[ROWS.length - 1]);
    rows.push(size);
    left -= size;
  }
  return rows;
}

/** L'ordre des mascottes : la choisie d'abord, puis l'ordre retenu, puis les nouvelles. */
export function podiumOrder(ids: string[], chosen: string, remembered: string[]): string[] {
  const rest = [...remembered.filter((id) => ids.includes(id) && id !== chosen), ...ids.filter((id) => id !== chosen && !remembered.includes(id))];
  return ids.includes(chosen) ? [chosen, ...rest] : [...rest];
}
