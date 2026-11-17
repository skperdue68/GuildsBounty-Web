// Real-time item lists over socket.io.
//
// The socket deliberately carries no item data. It says only "something you can
// see has changed", and each browser then re-fetches the list it is allowed to see
// through its own signed-in HTTP request. That keeps the visibility rules in one
// place (lib/store.js), so a mistake in the push path cannot show someone another
// guild's items, and every viewer gets exactly what a page load would have shown.
//
// One process, one broadcast. Several Node processes sharing the database would
// need a shared adapter (@socket.io/mysql): an upload handled by process A would
// otherwise never reach the sockets held by process B.

import { Server } from 'socket.io';

/**
 * Works out which hop dropped a websocket's `Upgrade` header, from the request that reached Node.
 *
 * Two things identify the last hop before this process: the address it connected from, and what
 * it said about itself on the way. Cloudflare always adds `cf-ray` (and `cf-connecting-ip`), and a
 * proxy on this machine connects from a loopback or private address. Those two together separate
 * the three cases worth naming:
 *
 *   Cloudflare -> Node          the zone is not carrying the upgrade
 *   Cloudflare -> local proxy   the local proxy is, and Cloudflare is not at fault
 *   a local proxy alone         the local proxy is
 *
 * Anything else is named by the address it came from, with the headers as evidence.
 *
 * @returns {string} a few lines for the log: what arrived, who that makes responsible, and the
 *   exact settings for that hop.
 */
export function describeDroppedUpgrade(req = {}) {
  const headers = req.headers || {};
  const peer = String((req.socket && (req.socket.remoteAddress || req.socket.address)) || '')
    .replace(/^::ffff:/i, '')
    .trim();
  const forwarded = String(headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  const cfRay = String(headers['cf-ray'] || '').trim();
  const throughCloudflare = Boolean(cfRay || headers['cf-connecting-ip']);

  const arrived = [
    `arrived from ${peer || 'an unknown address'}`,
    throughCloudflare ? `through Cloudflare (cf-ray ${cfRay || 'unstated'})` : 'with no cf-ray header',
    forwarded ? `x-forwarded-for ${forwarded}` : 'no x-forwarded-for',
  ].join(', ');

  const nginx = [
    '    location / {',
    '        proxy_pass http://127.0.0.1:3000;',
    '        proxy_http_version 1.1;',
    '        proxy_set_header Upgrade $http_upgrade;',
    '        proxy_set_header Connection "upgrade";',
    '    }',
    '  (nginx Proxy Manager: Edit proxy host -> toggle "Websockets Support" on.)',
  ].join('\n');

  const cloudflare = [
    '    Dashboard -> the zone for this host -> Network -> WebSockets: On.',
    '    If a Worker serves this host: proxy the upgrade (return the webSocket from fetch())',
    '    instead of re-fetching the URL as HTTP.',
    '    Rules -> Transform Rules: remove any rule that strips Connection or Upgrade.',
  ].join('\n');

  if (isCloudflareAddress(peer)) {
    return [
      `  ${arrived}.`,
      '  Node is reached directly by Cloudflare, so Cloudflare is the hop that dropped it.',
      `  to fix it, on Cloudflare:\n${cloudflare}`,
    ].join('\n');
  }

  if (isLocalAddress(peer)) {
    return throughCloudflare
      ? [
          `  ${arrived}.`,
          '  A proxy on this machine took the request from Cloudflare and re-issued it without the',
          '  upgrade headers, so that local proxy - not Cloudflare - is the hop that dropped them.',
          `  to fix it, in that proxy:\n${nginx}`,
          '  (A cloudflared tunnel passes websockets through on its own; only an nginx-style hop',
          '  in front of it needs the lines above.)',
        ].join('\n')
      : [
          `  ${arrived}.`,
          '  A local proxy is the last hop before Node, and it re-issued the request without the',
          '  upgrade headers, so it is the hop that dropped them.',
          `  to fix it, in that proxy:\n${nginx}`,
        ].join('\n');
  }

  return [
    `  ${arrived}.`,
    `  The last hop before Node is ${peer || 'an unnamed proxy'}, and it re-issued the request`,
    '  without the upgrade headers, so it is the one to change.',
    `  to fix it, at that proxy:\n${nginx}`,
  ].join('\n');
}

// Cloudflare's published IPv4 ranges (cloudflare.com/ips-v4). An address from here means
// Cloudflare itself opened the connection to Node.
const CLOUDFLARE_NETWORKS = [
  ['173.245.48.0', 20],
  ['103.21.244.0', 22],
  ['103.22.200.0', 22],
  ['103.31.4.0', 22],
  ['141.101.64.0', 18],
  ['108.162.192.0', 18],
  ['190.93.240.0', 20],
  ['188.114.96.0', 20],
  ['197.234.240.0', 22],
  ['198.41.128.0', 17],
  ['162.158.0.0', 15],
  ['104.16.0.0', 13],
  ['104.24.0.0', 14],
  ['172.64.0.0', 13],
  ['131.0.72.0', 22],
];

function ipv4ToNumber(address) {
  const parts = String(address).split('.');

  if (parts.length !== 4) {
    return null;
  }

  let value = 0;

  for (const part of parts) {
    const octet = Number(part);

    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }

    value = value * 256 + octet;
  }

  return value;
}

/** Whether this address is one Cloudflare connects from. */
export function isCloudflareAddress(address) {
  const value = ipv4ToNumber(address);

  if (value === null) {
    return false;
  }

  return CLOUDFLARE_NETWORKS.some(([network, bits]) => {
    const base = ipv4ToNumber(network);
    const size = 2 ** (32 - bits);

    return value >= base && value < base + size;
  });
}

/** Whether this address is this machine: loopback, a private range, or link-local. */
export function isLocalAddress(address) {
  const said = String(address || '').toLowerCase();

  if (said === '::1' || said === 'localhost') {
    return true;
  }

  if (said.startsWith('fc') || said.startsWith('fd') || said.startsWith('fe80')) {
    return true;
  }

  const value = ipv4ToNumber(said);

  if (value === null) {
    return false;
  }

  const first = Math.floor(value / 2 ** 24);
  const second = Math.floor((value % 2 ** 24) / 2 ** 16);

  return (
    first === 127 || first === 10 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31) || (first === 169 && second === 254)
  );
}

export function attachRealtime({
  httpServer,
  sessionMiddleware,
  path = '/socket.io',
  coalesceMs = 120,
  log = console,
  // How many asks are waiting on this person's items right now. Supplied by the server so
  // a socket that has just connected - or reconnected after the laptop slept - can be told
  // the current number without the page being rebuilt.
  resolvePending = null,
} = {}) {
  const io = new Server(httpServer, {
    path,
    serveClient: true,
    // Polling first so the very first update after load cannot be missed while the
    // websocket is still being negotiated; the client upgrades on its own.
    transports: ['polling', 'websocket'],
  });

  // ------------------------------------------------------ the upgrade a proxy can eat
  // A browser asks for the websocket with `Connection: Upgrade` and `Upgrade: websocket`. A proxy
  // that forwards the request without them hands Node an ordinary GET for the websocket
  // transport, and engine.io answers that with 400 "Bad request" - which reaches the browser as a
  // failed connection with no explanation at all. Nothing in this process can accept it, so the
  // log names the hop that dropped it, from the headers the request actually arrived with, and
  // prints the settings that fix that hop.
  let refusedUpgradeAt = 0;

  httpServer.on('request', (req) => {
    const url = req && req.url;

    if (!url || !url.includes('transport=websocket')) {
      return;
    }

    if (String((req.headers && req.headers.upgrade) || '').toLowerCase() === 'websocket') {
      return;
    }

    const now = Date.now();

    if (now - refusedUpgradeAt < 60000) {
      return;
    }

    refusedUpgradeAt = now;

    const said = describeDroppedUpgrade(req);
    log.warn(`Live updates: a websocket was asked for without its Upgrade header, so Node refused it (400 "Bad request").\n${said}`);
  });

  // The same middleware Express uses, so a socket is tied to the same signed cookie
  // as the page that opened it. Without it a push could not tell a member from a
  // stranger, and the next feature that needs "your" items would have no user.
  io.engine.use(sessionMiddleware);

  io.use((socket, next) => {
    const session = socket.request.session || {};
    socket.data.userId = session.user ? session.user.id : null;
    // A demo page gets its own room: the sandbox's activity is real, but it happened
    // only inside the copy, so announcing it to everybody else would be a lie.
    socket.data.isDemo = Boolean(session.user && session.user.isDemo);
    next();
  });

  const DEMO_ROOM = 'demo';
  // One room per signed-in person, so an update that concerns only them reaches every
  // window and device they have open and nobody else's.
  const userRoom = (userId) => `user:${Number(userId)}`;

  let clients = 0;
  let revision = 0;
  let pendingReason = null;
  let pendingMessages = [];
  let pendingTimer = null;

  function flush() {
    pendingTimer = null;
    revision += 1;

    const reason = pendingReason || 'items';
    const said = pendingMessages.join('; ');
    // Anything the simulator caused is labelled, in the log and in the browser: a
    // handover nobody really made must not read like one that happened.
    const message = reason === 'simulation' && said ? `[SIMULATE] ${said}` : said;

    const payload = {
      revision,
      reason,
      message,
      at: Date.now(),
    };
    pendingReason = null;
    pendingMessages = [];

    io.emit('items:changed', payload);

    // Read as a sentence: what happened, then who saw it. "revision 7 (request) sent
    // to 1 page" answered neither of the questions someone reading the log has.
    log.log(`Live: ${payload.message || `item list changed (${payload.reason})`} - ${audience()}`);

    return payload;
  }

  /** How many open pages this went to, in words. One socket is one open page. */
  function audience() {
    if (clients === 0) {
      return 'no pages open, so nothing was pushed';
    }

    return `${clients} open page${clients === 1 ? '' : 's'} told to refresh`;
  }

  /**
   * Announces that visible rows may have changed. Calls inside the same short
   * window collapse into one broadcast, because one upload can commit items and
   * then fetch their icons a moment later.
   *
   * `message` is the human summary that ends up in the log, so the caller can say
   * who did what: "@DemoTrader asked for 2 x Soul Gem".
   */
  function notifyChange(reason = 'items', message = '') {
    pendingReason = reason;

    if (message) {
      pendingMessages.push(message);
    }

    if (pendingTimer) {
      return;
    }

    pendingTimer = setTimeout(flush, coalesceMs);
    // Never the reason a process stays alive or shuts down late.
    if (typeof pendingTimer.unref === 'function') {
      pendingTimer.unref();
    }
  }

  io.on('connection', (socket) => {
    clients += 1;

    if (socket.data.isDemo) {
      socket.join(DEMO_ROOM);
    }

    if (socket.data.userId) {
      socket.join(userRoom(socket.data.userId));

      // A page that has just joined, or rejoined, is told the number that stands now: an
      // event sent while the tab was asleep would otherwise leave a stale circle behind,
      // which is the same problem as having to refresh.
      if (resolvePending && !socket.data.isDemo) {
        Promise.resolve()
          .then(() => resolvePending(socket.data.userId))
          .then((count) => {
            socket.emit('requests:pending', { count: Math.max(0, Math.trunc(Number(count) || 0)), at: Date.now() });
          })
          // A count that cannot be read leaves the page with the one it was drawn with,
          // which is still true - and the next change will correct it.
          .catch(() => {});
      }
    }

    socket.on('disconnect', () => {
      clients = Math.max(0, clients - 1);
    });
  });

  // ------------------------------------------------------------ the demo room
  // Everything a demo session does happens in its own database, so it must not reach an
  // ordinary page - but a demo visitor with two tabs open still deserves the same live
  // updates. This is the same coalesced broadcast, addressed to the demo room only.
  let demoRevision = 0;
  let demoTimer = null;
  let demoMessages = [];

  function demoAudience() {
    const room = io.sockets.adapter.rooms.get(DEMO_ROOM);
    const size = room ? room.size : 0;

    if (size === 0) {
      return 'no demo page open, so nothing was pushed';
    }

    return `${size} demo page${size === 1 ? '' : 's'} told to refresh`;
  }

  function flushDemo() {
    demoTimer = null;
    demoRevision += 1;

    const message = demoMessages.join('; ');
    demoMessages = [];

    const payload = {
      revision: demoRevision,
      reason: 'simulation',
      message,
      at: Date.now(),
      demo: true,
    };

    io.to(DEMO_ROOM).emit('items:changed', payload);
    log.log(`Live demo: ${message || 'the demo copy changed'} - ${demoAudience()}`);

    return payload;
  }

  /**
   * Announces a change that happened inside the demo copy. Only demo pages hear it, and
   * a change made by the visitor themselves is announced the same way, so two demo tabs
   * stay in step without the rest of the site being told anything.
   */
  function notifyDemoChange(reason = 'simulation', message = '') {
    if (message) {
      demoMessages.push(message);
    }

    if (demoTimer) {
      return;
    }

    demoTimer = setTimeout(flushDemo, coalesceMs);

    if (typeof demoTimer.unref === 'function') {
      demoTimer.unref();
    }
  }

  /**
   * Tells one person how many asks are waiting on their items, on every page they have open.
   *
   * Addressed to their room rather than broadcast: the number is about their own shelf, and
   * nobody else's page has anything to do with it. The payload is the total, not a delta, so
   * two events arriving out of order cannot leave a wrong number on screen.
   */
  function notifyPendingRequests(userId, count) {
    const id = Number(userId) || 0;

    if (id <= 0) {
      return null;
    }

    const payload = { count: Math.max(0, Math.trunc(Number(count) || 0)), at: Date.now() };

    io.to(userRoom(id)).emit('requests:pending', payload);

    const room = io.sockets.adapter.rooms.get(userRoom(id));
    const size = room ? room.size : 0;

    log.log(
      `Live: ${payload.count} request${payload.count === 1 ? '' : 's'} to process - ${
        size === 0
          ? 'no page open for them, so nothing was pushed'
          : `${size} page${size === 1 ? '' : 's'} updated`
      }`
    );

    return payload;
  }

  return {
    io,
    notifyChange,
    notifyPendingRequests,
    notifyDemoChange,
    revision: () => revision,
    demoRevision: () => demoRevision,
    clients: () => clients,
    demoClients: () => {
      const room = io.sockets.adapter.rooms.get(DEMO_ROOM);
      return room ? room.size : 0;
    },
    close: () => new Promise((resolve) => io.close(resolve)),
  };
}
