const { parentPort } = require("node:worker_threads");
parentPort.on("message", ({ id, request }) => {
  const size = request.input.size;
  if (size === 999) return;
  if (size === 998) process.exit(7);
  setTimeout(
    () =>
      parentPort.postMessage({
        id,
        result: {
          kind: "SYMBOL",
          result: {
            svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${size}</text></svg>`,
          },
        },
      }),
    size === 997 ? 300 : 0,
  );
});
