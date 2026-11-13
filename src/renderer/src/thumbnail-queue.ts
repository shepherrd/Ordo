// Thumbnails share a small queue so catalogs cannot exhaust the render IPC limit.
let running = 0;
const pending: (() => void)[] = [];
function pump() {
  while (running < 2 && pending.length) pending.shift()!();
}
export function queueThumbnail<T>(
  task: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      const index = pending.indexOf(start);
      if (index >= 0) {
        pending.splice(index, 1);
        reject(Error("Thumbnail cancelled"));
      }
    };
    const start = () => {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted) {
        reject(Error("Thumbnail cancelled"));
        return;
      }
      running++;
      void task()
        .then(resolve, reject)
        .finally(() => {
          running--;
          pump();
        });
    };
    pending.push(start);
    signal.addEventListener("abort", cancel, { once: true });
    pump();
  });
}
