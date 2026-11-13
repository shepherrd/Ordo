export type TextPart = { text: string; changed: boolean };
// Bounded common-word alignment keeps long narratives responsive and avoids HTML parsing.
export function textDifference(
  before: string,
  after: string,
): { before: TextPart[]; after: TextPart[] } {
  const a = before.split(/(\s+)/),
    b = after.split(/(\s+)/);
  const commonA = new Set<number>(),
    commonB = new Set<number>();
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    commonA.add(start);
    commonB.add(start++);
  }
  let ai = a.length - 1,
    bi = b.length - 1;
  while (ai >= start && bi >= start && a[ai] === b[bi]) {
    commonA.add(ai--);
    commonB.add(bi--);
  }
  if ((ai - start + 1) * (bi - start + 1) <= 90000) {
    const rows = Array.from(
      { length: ai - start + 2 },
      () => new Uint16Array(bi - start + 2),
    );
    for (let i = ai; i >= start; i--)
      for (let j = bi; j >= start; j--)
        rows[i - start][j - start] =
          a[i] === b[j]
            ? 1 + rows[i - start + 1][j - start + 1]
            : Math.max(
                rows[i - start + 1][j - start],
                rows[i - start][j - start + 1],
              );
    let i = start,
      j = start;
    while (i <= ai && j <= bi) {
      if (a[i] === b[j]) {
        commonA.add(i++);
        commonB.add(j++);
      } else if (
        rows[i - start + 1][j - start] >= rows[i - start][j - start + 1]
      )
        i++;
      else j++;
    }
  }
  const parts = (words: string[], common: Set<number>) =>
    words.reduce<TextPart[]>((out, text, i) => {
      const changed = !common.has(i);
      if (out.at(-1)?.changed === changed) out[out.length - 1].text += text;
      else out.push({ text, changed });
      return out;
    }, []);
  return { before: parts(a, commonA), after: parts(b, commonB) };
}
