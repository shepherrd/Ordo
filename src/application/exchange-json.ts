import { m6Limits } from "../domain/orbat";
/** Inspect framing before JSON.parse, including keys it would otherwise silently overwrite. */
export function parseExchangeJson(text: string): unknown {
  if (new TextEncoder().encode(text).byteLength > m6Limits.jsonBytes)
    throw Error("Import exceeds 10 MiB");
  const stack: { kind: string; keys: Set<string>; expectKey: boolean }[] = [];
  let keys = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      let ended = false;
      for (i++; i < text.length; i++) {
        if (text[i] === "\\") {
          i++;
          continue;
        }
        if (text[i] === '"') {
          ended = true;
          break;
        }
      }
      if (!ended) throw Error("Unterminated JSON string");
      const frame = stack.at(-1);
      if (frame?.kind === "{" && frame.expectKey) {
        const key = JSON.parse(text.slice(start, i + 1)) as string;
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw Error("Unsafe JSON key: " + key);
        if (frame.keys.has(key)) throw Error("Duplicate JSON key: " + key);
        if (++keys > 100000) throw Error("Import contains too many fields");
        frame.keys.add(key);
        frame.expectKey = false;
      }
    } else if (char === "{" || char === "[") {
      stack.push({ kind: char, keys: new Set(), expectKey: char === "{" });
      if (stack.length > 160) throw Error("Import nesting limit exceeded");
    } else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && stack.at(-1)?.kind === "{")
      stack.at(-1)!.expectKey = true;
  }
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}
