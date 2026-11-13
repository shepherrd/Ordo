// Stable-ID LCS, using LIS of old indexes: insertion does not move every later item.
export function movedIds(before: string[], after: string[]): string[] {
  const old = new Map(before.map((id, i) => [id, i]));
  const common = after.filter((id) => old.has(id));
  const tails: number[] = [],
    indexes: number[] = [],
    previous = new Array<number>(common.length).fill(-1);
  common.forEach((id, i) => {
    const n = old.get(id)!;
    let lo = 0,
      hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (tails[mid] < n) lo = mid + 1;
      else hi = mid;
    }
    if (lo) previous[i] = indexes[lo - 1];
    tails[lo] = n;
    indexes[lo] = i;
  });
  const retained = new Set<string>();
  let i = indexes.at(-1) ?? -1;
  while (i >= 0) {
    retained.add(common[i]);
    i = previous[i];
  }
  return common.filter((id) => !retained.has(id));
}
