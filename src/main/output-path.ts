import { existsSync, realpathSync } from "node:fs";
import {
  dirname,
  basename,
  resolve,
  relative,
  isAbsolute,
  sep,
} from "node:path";
export function assertSafeOutput(path: string, dataDirectory: string) {
  const real = (p: string) =>
    existsSync(p)
      ? realpathSync(p)
      : resolve(realpathSync(dirname(p)), basename(p));
  const target = real(path).toLowerCase(),
    data = real(dataDirectory).toLowerCase(),
    inside = relative(data, target);
  if (
    !inside ||
    (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
  )
    throw Error(
      "Choose an output location outside Ordo's active workspace folder.",
    );
}
