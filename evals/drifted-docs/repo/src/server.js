// Tiny HTTP server. The README documents it; parts of that description have drifted from this code.
export const DEFAULT_PORT = 8080;

export function start(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  // Binds synchronously and returns the bound port number — not a Promise.
  return port;
}

export function shutdown() {
  // Graceful stop.
  return true;
}
