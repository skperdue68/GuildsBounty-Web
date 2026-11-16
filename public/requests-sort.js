// Sorting for the request tables: what is waiting on your items, and what My Requests and
// Requests Received draw underneath them.
//
// A heading sorts by its own column. A press cycles that column - ascending, descending, off -
// and several can be on at once. The second is only consulted for rows the first cannot
// separate, so the columns apply in the order they were pressed, not the order they sit on
// screen: press Mail to, then Asked, and you get the mailboxes in order with the oldest ask
// first inside each one.
//
// The order is a reading preference, so it lives in a cookie and never in the address bar -
// the same rule the item list's sort follows, for the same reason: a link stays a plain link
// to the page. Each table has its own cookie, because an order read in the basket says nothing
// about the log of everything sent.
//
// A table declares what it sorts by on its own container:
//
//   data-sort-table
//   data-sort-cookie="guildsbounty_basket_sort"
//   data-sort-fields="name,from,qty,status"
//   data-sort-numeric="qty"
//
// The owner's list (`[data-owner-requests]`) carries none of those and gets the defaults below,
// which is what it has always used - the same cookie, the same four columns.
//
// This file is a module and listens on the document rather than on a table, because the owner's
// card arrives twice in a page's life: rendered with the page, and fetched into the modal over
// the item list afterwards.

export const ORDER_COOKIE = 'guildsbounty_owner_sort';

// The owner's list: the item, where the copy is stored, who it has to be mailed to, and when it
// was first asked for. The order a column sits in the queue is the order these fields were
// asked for, so it is stored as written - `mail:asc,asked:desc` - rather than as flags per
// column.
export const FIELDS = ['name', 'stored', 'mail', 'asked'];

// Columns compared as numbers rather than as words. Asked is a stamp, so "9" sorts before "10";
// a quantity would otherwise read "10, 2, 9".
export const NUMERIC = ['asked'];

/** Everything a container sorts by, with the owner's list as the default. */
export function configFor(container) {
  const read = (name) => (container && container.dataset ? container.dataset[name] : '') || '';
  const list = (value) =>
    String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

  return {
    cookie: read('sortCookie') || ORDER_COOKIE,
    fields: list(read('sortFields')).length ? list(read('sortFields')) : FIELDS,
    numeric: read('sortNumeric') ? list(read('sortNumeric')) : NUMERIC,
  };
}

/** The queue a cookie holds, with anything unreadable dropped rather than guessed at. */
export function parseOrder(value, fields = FIELDS) {
  const order = [];

  for (const part of String(value || '').split(',')) {
    const [field, dir] = part.split(':').map((piece) => piece.trim());

    if (!fields.includes(field) || (dir !== 'asc' && dir !== 'desc')) continue;
    if (order.some((entry) => entry.field === field)) continue;

    order.push({ field, dir });
  }

  return order;
}

/** The queue as it goes back into the cookie. An empty queue writes an empty string. */
export function formatOrder(order) {
  return (order || []).map(({ field, dir }) => `${field}:${dir}`).join(',');
}

/**
 * What one press on a heading does.
 *
 * A column that is off joins the end of the queue ascending. Pressed again it reverses in
 * place, keeping its turn, so turning the second column around does not promote it over the
 * first. Pressed a third time it leaves, and the columns after it move up.
 */
export function cycleOrder(order, field, fields = FIELDS) {
  if (!fields.includes(field)) return order;

  const at = order.findIndex((entry) => entry.field === field);

  if (at === -1) return [...order, { field, dir: 'asc' }];

  if (order[at].dir === 'asc') {
    return order.map((entry, index) => (index === at ? { field, dir: 'desc' } : entry));
  }

  return order.filter((entry, index) => index !== at);
}

/**
 * Where a column stands in the queue: 1 for the one that decides, 2 for the one that only
 * breaks its ties, and so on. Null when the column is off.
 *
 * Read from the queue every time the headings are painted rather than kept on the heading,
 * which is what makes removing a column renumber the ones behind it: switch off the first
 * sort and the second is no longer second, with nothing in front of it.
 */
export function queuePlace(order, field) {
  const at = (order || []).findIndex((entry) => entry.field === field);

  return at === -1 ? null : { rank: at + 1, dir: order[at].dir };
}

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

// Numeric so "Bow 2" follows "Bow 1", and base so case and accents do not decide the order:
// an item's name is a label, not an identifier.
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * Rows in the order the queue asks for, with the reader's own order kept for ties.
 *
 * A row with nothing in the column - no Stored at, say, because it was never recorded - sinks
 * to the bottom whichever way the column runs. Sorting it to the top on a descending pass would
 * bury the rows that do have an answer.
 */
export function sortRows(rows, order, numeric = NUMERIC) {
  const entries = (rows || []).map((row, index) => ({ row, index }));
  const queue = (order || []).filter((entry) => entry.field);
  const numbers = numeric || [];

  entries.sort((left, right) => {
    for (const { field, dir } of queue) {
      const leftValue = text(left.row[field]);
      const rightValue = text(right.row[field]);
      const leftEmpty = leftValue === '';
      const rightEmpty = rightValue === '';

      if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
      if (leftEmpty) continue;

      const compared = numbers.includes(field)
        ? Number(leftValue) - Number(rightValue)
        : collator.compare(leftValue, rightValue);

      if (compared) return dir === 'desc' ? -compared : compared;
    }

    return left.index - right.index;
  });

  return entries.map((entry) => entry.row);
}

// ------------------------------------------------------------------- the page itself

if (typeof document !== 'undefined') {
  // A container is one table's headings and rows: the owner's card, or one of the tables in a
  // tab. Everything about how it sorts comes off the container, so a new table needs markup
  // rather than another script.
  const TABLES = '[data-owner-requests], [data-sort-table]';

  function readCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function writeCookie(name, value) {
    document.cookie = `${name}=${encodeURIComponent(
      value
    )}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  /** The rows, read through the keys the markup wrote for them. */
  function readRows(table, fields) {
    const body = table.tBodies[0];

    if (!body) return [];

    return Array.from(body.rows)
      .filter((element) => !element.classList.contains('empty-row'))
      .map((element, index) => {
        const row = { element, index };

        for (const field of fields) {
          const key = `sort${field.charAt(0).toUpperCase()}${field.slice(1)}`;
          row[field] = element.dataset[key] || '';
        }

        return row;
      });
  }

  // The badge is the whole point of a queued order: without it a second column looks like
  // it did nothing, because the first still decides most of the table. The rank is drawn as
  // a superscript before the arrow, the way a footnote to it would be written, so "2 then
  // a down arrow" reads as the second sort, biggest first.
  function paintHeadings(container, order) {
    for (const button of container.querySelectorAll('[data-request-sort]')) {
      const field = button.dataset.requestSort;
      const label = button.dataset.sortLabel || field;
      const place = queuePlace(order, field);
      const badge = button.querySelector('[data-sort-queue]');
      const heading = button.closest('th');

      button.dataset.dir = place ? place.dir : '';
      button.classList.toggle('active', Boolean(place));
      button.setAttribute(
        'aria-label',
        place
          ? `${label}, sorted ${
              place.dir === 'asc' ? 'ascending' : 'descending'
            }, ${place.rank} in the sort order`
          : `${label}, not sorted`
      );

      if (heading) {
        heading.setAttribute(
          'aria-sort',
          place ? (place.dir === 'asc' ? 'ascending' : 'descending') : 'none'
        );
      }

      if (badge) {
        // Rebuilt rather than edited: a heading that just lost its turn has to come back as
        // nothing, not as a stale number.
        badge.replaceChildren();

        if (place) {
          const rank = document.createElement('sup');
          rank.className = 'sort-rank';
          rank.textContent = String(place.rank);
          badge.append(rank, place.dir === 'asc' ? '\u25b2' : '\u25bc');
        }

        badge.hidden = !place;
      }
    }
  }

  function applySort(container) {
    const table = container.querySelector('table');
    const config = configFor(container);
    const order = parseOrder(readCookie(config.cookie), config.fields);

    if (table && table.tBodies[0]) {
      const body = table.tBodies[0];

      for (const row of sortRows(readRows(table, config.fields), order, config.numeric)) {
        body.appendChild(row.element);
      }
    }

    paintHeadings(container, order);
  }

  function sortEveryTable() {
    for (const container of document.querySelectorAll(TABLES)) applySort(container);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest ? event.target.closest('[data-request-sort]') : null;

    if (!button) return;

    event.preventDefault();

    const container = button.closest(TABLES);

    if (!container) return;

    const config = configFor(container);
    const next = cycleOrder(
      parseOrder(readCookie(config.cookie), config.fields),
      button.dataset.requestSort,
      config.fields
    );

    writeCookie(config.cookie, formatOrder(next));
    applySort(container);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sortEveryTable, { once: true });
  } else {
    sortEveryTable();
  }

  // A live refresh, or the modal, puts fresh tables on the page: they arrive in the server's
  // order, so each one is sorted as it lands rather than waiting for the next press.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;

        if (node.matches(TABLES)) {
          applySort(node);
          continue;
        }

        if (node.querySelectorAll) {
          for (const container of node.querySelectorAll(TABLES)) applySort(container);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
