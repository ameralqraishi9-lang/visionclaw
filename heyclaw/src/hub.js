/**
 * Server-sent events hub.
 *
 * One stream per signed-in tab. Every mutation the API makes is pushed to the
 * user's other tabs so the console stays live without polling (and so two
 * windows open side by side agree with each other).
 */
export function createHub() {
  /** @type {Map<string, Set<import('node:http').ServerResponse>>} */
  const clients = new Map();

  function addClient(userId, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: 3000\n\n`);

    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(res);

    const ping = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        cleanup();
      }
    }, 20_000);

    const cleanup = () => {
      clearInterval(ping);
      const set = clients.get(userId);
      if (!set) return;
      set.delete(res);
      if (!set.size) clients.delete(userId);
    };

    res.on("close", cleanup);
    res.on("error", cleanup);

    // Let the client know the stream is live and catch it up.
    send(res, "ready", { connected: true, at: new Date().toISOString() });
    return cleanup;
  }

  function send(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* client vanished mid-write; close handler will clean up */
    }
  }

  function broadcast(userId, event, data) {
    const set = clients.get(userId);
    if (!set) return;
    for (const res of set) send(res, event, data);
  }

  function count() {
    let total = 0;
    for (const set of clients.values()) total += set.size;
    return total;
  }

  return { addClient, broadcast, count };
}
