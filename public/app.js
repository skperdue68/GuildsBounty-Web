// Guild's Bounty page behaviour: uploads, the account menu and the live item lists.
//
// Everything here is an enhancement. The logout form posts without scripts and the
// filter form still submits on its own, so a failed script costs convenience only.

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('savedvars');
const fileName = document.getElementById('fileName');
const toast = document.getElementById('toast');

// Filled in by the list code once it can refresh without a page load; until then a
// change has to be shown the only other way there is.
let refreshListsSoon = null;

function refreshAfterChange() {
  if (refreshListsSoon) {
    refreshListsSoon(0);
    return;
  }

  window.location.reload();
}

// ------------------------------------------------------------------ sticky bars
// The block above the tabs, the line of tabs, the filter band, the search row and the column
// headings pin to the top of the window one under another, so a long list keeps what there is
// to browse, whose guilds it comes from, which list is open, what is in it and what each column
// is. None of the offsets can live in the stylesheet: the site header is as tall as the account
// line and the basket bar make it, the block above the tabs is as tall as its three lines, the
// tab row is as tall as the tabs in it, and the search row is as tall as the box in it (and is
// not there at all on a table that carries no search). All of them are measured here and
// published as custom properties for the stylesheet to add up.
function measureStickyBars() {
  const root = document.documentElement;

  const publishPixels = (name, pixels) => {
    const value = `${Math.round(pixels)}px`;
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  };

  // A bar that is not on the page is 0px tall, not the height it had on the last page or in
  // the last state: a stale offset would push everything below it down into empty space.
  const publish = (name, element) => {
    publishPixels(name, element ? element.getBoundingClientRect().height : 0);
  };

  publish('--sticky-top', document.querySelector('.top-bar'));
  publish('--list-top-h', document.querySelector('.list-top'));
  publish('--list-head-h', document.querySelector('.list-head'));

  // The filter band sits between the two: a tab with no row of its own - My Requests,
  // Requests Received - hides it, and its height measures 0px, which leaves the search row
  // and the headings exactly where they would have been.
  publish('--list-band-h', document.querySelector('.filter-band'));

  // The tallest search row on the page, because a card can hold two tables that each carry
  // one and the headings have to clear whichever stands over them. Nothing on the page means
  // 0px, which leaves the headings exactly where they were.
  //
  // Only the rows that are on screen: every tab's list stays in the document, and a row in a
  // hidden panel was still measured - a tall one there pushed the headings and the pinned copy
  // of every visible table down by its whole height, which left the rows above them showing.
  publishPixels(
    '--list-tools-h',
    [...document.querySelectorAll('.list-tools')]
      .filter((bar) => bar.offsetParent !== null)
      .reduce((tallest, bar) => Math.max(tallest, bar.getBoundingClientRect().height), 0)
  );
}

measureStickyBars();

if (typeof ResizeObserver === 'function') {
  const observer = new ResizeObserver(measureStickyBars);

  // Every bar whose height is published, watched directly. The one that moves without the
  // window doing anything is the block above the tabs: its guild pills wrap onto a second
  // line as the window narrows, and the block grows by a whole line - the tabs and headings
  // below it have to move down with it, or they pin over its last line.
  for (const selector of ['.top-bar', '.list-top', '.list-head', '.filter-band']) {
    const bar = document.querySelector(selector);
    if (bar) observer.observe(bar);
  }

  // The list region is replaced when it refreshes, so the body is watched for it: the tab
  // row can come back at a different height, and a stale offset would leave the headings a
  // few pixels away from the tabs pinned above them.
  observer.observe(document.body);
} else {
  window.addEventListener('resize', measureStickyBars);
}

// -------------------------------------------------------------- folding the block
// The block above the tabs - what is shared, whose guilds it comes from, which account is
// asking - can be folded down to the live pill. It is three lines of context and the tallest
// bar in the pinned stack, so a reader who wants the rows can have the space back. The choice
// lives here rather than in the markup because a live refresh replaces the region: the block
// comes back expanded, and this puts it back the way the reader left it.
let listTopCollapsed = false;

function applyListTopState(root = document) {
  const block = root.querySelector('.list-top');
  if (!block) return;

  block.toggleAttribute('data-collapsed', listTopCollapsed);

  const button = block.querySelector('[data-list-top-toggle]');
  if (!button) return;

  const label = listTopCollapsed ? 'Expand the list header' : 'Collapse the list header';
  button.setAttribute('aria-expanded', String(!listTopCollapsed));
  button.title = label;

  const caption = button.querySelector('.visually-hidden');
  if (caption) caption.textContent = label;
}

document.addEventListener('click', (event) => {
  const target = event.target;
  const button = target && target.closest ? target.closest('[data-list-top-toggle]') : null;

  if (!button) return;

  event.preventDefault();
  listTopCollapsed = !listTopCollapsed;
  applyListTopState();
  // The block has just changed height, and everything pinned under it moves with it: measured
  // here rather than left to the observer, so the tabs and headings do not lag a frame behind.
  measureStickyBars();
  schedulePinnedTableHeads();
});

// ------------------------------------------------------- pinned table headings
// A sticky <th> pins to the nearest scroll container. On a window too narrow for the ten
// columns that container is the table's own shell - it scrolls sideways and never down - so
// the heading row went up with the rows instead of staying under the search row. Each item
// table gets a copy of its heading row in a bar of its own, outside the shell and in the same
// place in the pinned stack; the copy is drawn from the table's own colgroup under the same
// fixed layout, so its columns sit exactly over the ones below, and it is moved sideways with
// the shell as that scrolls.
const pinnedTableHeads = new Map();

function buildTableHead(shell) {
  // Every table in a shell, not only the item ones: the request tables need this just as much,
  // and they are drawn from a plain <table> with no colgroup to follow.
  const table = shell.querySelector('table');
  if (!table || !table.tHead || !table.tHead.rows.length) {
    return null;
  }

  const bar = document.createElement('div');
  bar.className = 'table-head';
  bar.hidden = true;
  // A copy for the eye: the headings that carry the sort buttons are the table's own.
  bar.setAttribute('aria-hidden', 'true');

  const inner = document.createElement('div');
  inner.className = 'table-head-inner';

  const copy = document.createElement('table');
  copy.className = table.className;
  copy.setAttribute('aria-hidden', 'true');

  // Under auto layout a table sizes its columns from its rows, and the copy has none: each of
  // its columns is given the width the table itself gave that column, in syncPinnedTableHeads.
  if (!table.querySelector('colgroup')) {
    copy.style.tableLayout = 'fixed';
  }

  const addHead = () => {
    const head = table.tHead.cloneNode(true);
    for (const control of head.querySelectorAll('button, a, input')) {
      control.tabIndex = -1;
    }

    if (copy.tHead) {
      copy.replaceChild(head, copy.tHead);
    } else {
      copy.append(head);
    }
  };

  const columns = table.querySelector('colgroup');
  if (columns) {
    copy.append(columns.cloneNode(true));
  }
  addHead();

  // A press on the copy is a press on the column: the buttons it holds carry the table's own
  // data-sort, and the list's click handler reads the field off whichever one was pressed. Only
  // the focus is stopped - a copy is out of sight the moment the list moves under it, so the
  // caret is left where the reader had it.
  //
  // Every kind of pointer is covered, because they focus at different moments: a mouse takes the
  // focus on mousedown, while a finger or a pen takes it on pointerdown. Cancelling the default
  // there stops the focus and leaves the click to come through on its own, so a tap still sorts.
  const onCopiedButton = (event) => Boolean(event.target.closest && event.target.closest('button'));

  bar.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' && onCopiedButton(event)) {
      event.preventDefault();
    }
  });

  bar.addEventListener('mousedown', (event) => {
    if (onCopiedButton(event)) {
      event.preventDefault();
    }
  });

  // Nothing outside this bar can work out what was pressed on: the copy stands outside its
  // table, so a handler that looks for the table from the pressed button finds nothing. The
  // press is handed to the heading cell it copies, and the copy is redrawn from the result so
  // that its arrow and aria-sort follow - in the same tick for a table sorted in place, and on
  // the next refresh for one whose list is redrawn.
  bar.addEventListener('click', (event) => {
    event.stopPropagation();

    const cell = event.target.closest ? event.target.closest('th') : null;
    if (!cell) {
      return;
    }

    event.preventDefault();

    const index = [...copy.tHead.rows[0].cells].indexOf(cell);
    const real = index < 0 ? null : table.tHead.rows[0].cells[index];
    const button = real ? real.querySelector('button') : null;
    if (!button) {
      return;
    }

    button.click();
    addHead();
  });

  inner.append(copy);
  bar.append(inner);

  // Before the table's search row rather than between it and the shell: the shell's own heading
  // cells take their offset from standing directly under that row, so the bar must not come
  // between them.
  const tools = shell.previousElementSibling;
  const leads = tools && tools.classList.contains('list-tools');
  (leads ? tools : shell).before(bar);

  return { bar, inner, copy, table };
}

// The lowest pinned bar standing above a table. A table whose own headings sit below the bars
// it clears can still be reached by a patch of rows when one of those bars has not arrived at
// its line yet - the strip between them shows the rows scrolling behind. The copy pins on
// whichever is lower, the headings' own line or the bottom of the bar above it, so there is no
// strip for rows to show through.
function pinnedFloor(shell) {
  let floor = 0;

  for (const bar of document.querySelectorAll(
    '.top-bar, .list-top, .list-head, .filter-band, .list-tools'
  )) {
    if (!bar.offsetParent) continue;
    if (!(bar.compareDocumentPosition(shell) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;

    const rect = bar.getBoundingClientRect();
    const own = parseFloat(window.getComputedStyle(bar).top) || 0;

    if (rect.top <= own + 1) {
      floor = Math.max(floor, rect.bottom);
    }
  }

  return floor;
}

function syncPinnedTableHeads() {
  for (const gone of pinnedTableHeads.keys()) {
    if (!gone.isConnected) {
      pinnedTableHeads.delete(gone);
    }
  }

  for (const shell of document.querySelectorAll('.table-shell')) {
    let entry = pinnedTableHeads.get(shell);
    if (!entry) {
      entry = buildTableHead(shell);
      if (!entry) {
        continue;
      }
      pinnedTableHeads.set(shell, entry);
      shell.addEventListener('scroll', schedulePinnedTableHeads, { passive: true });
    }

    const { bar, inner, copy, table } = entry;
    // The cells, not the thead: sticky cells leave the thead's box behind, and it is the
    // cells that have gone under the bars above when the copy is wanted.
    const heading = table.tHead.querySelector('th') || table.tHead;

    // The bar pins on the line the table's own headings pin on. They already know what stands
    // above them - a search row, a standing-offers bar, neither - so nothing here has to guess.
    const line = Math.max(parseFloat(window.getComputedStyle(heading).top) || 0, pinnedFloor(shell));
    const top = `${Math.round(line)}px`;
    if (bar.style.top !== top) {
      bar.style.top = top;
    }

    const head = heading.getBoundingClientRect();
    const box = shell.getBoundingClientRect();

    // Wherever the columns fit, the table's own heading row pins itself and this bar stays out
    // of the way. Once that row has gone under the bars above - and while rows still reach the
    // bottom of the window - the copy stands in for it.
    const wanted = head.top < line - 0.5 && box.bottom > line + head.height;
    bar.hidden = !wanted;
    if (!wanted) {
      continue;
    }

    const width = Math.round(table.getBoundingClientRect().width);
    if (copy.style.width !== `${width}px`) {
      copy.style.width = `${width}px`;
    }

    // A table laid out automatically has no colgroup for this to follow, so every column of the
    // copy is given the width that column has below it.
    if (!copy.querySelector('colgroup') && copy.tHead) {
      const cells = [...table.tHead.rows[0].cells];
      const copies = [...copy.tHead.rows[0].cells];
      cells.forEach((cell, index) => {
        const column = `${Math.round(cell.getBoundingClientRect().width)}px`;
        if (copies[index] && copies[index].style.width !== column) {
          copies[index].style.width = column;
        }
      });
    }

    inner.style.transform = `translateX(${-shell.scrollLeft}px)`;
  }
}

let pinnedTableHeadsQueued = false;

function schedulePinnedTableHeads() {
  if (pinnedTableHeadsQueued) {
    return;
  }
  pinnedTableHeadsQueued = true;
  window.requestAnimationFrame(() => {
    pinnedTableHeadsQueued = false;
    syncPinnedTableHeads();
  });
}

window.addEventListener('scroll', schedulePinnedTableHeads, { passive: true });
window.addEventListener('resize', schedulePinnedTableHeads);

// The list region is replaced when it refreshes, and redrawn when a filter, a search or a sort
// changes what it holds, so the bars are built again from whatever shells are there now.
if (typeof MutationObserver === 'function') {
  new MutationObserver(schedulePinnedTableHeads).observe(document.body, {
    childList: true,
    subtree: true,
  });
}

schedulePinnedTableHeads();

// ----------------------------------------------------------------- demo presence
// A demo page keeps the sandbox alive: the server lets the demo's other guildmates act
// only while at least one demo page is open, and this is how it knows. Nothing is sent
// from an ordinary page, and a failed ping costs nothing - the activity simply pauses.
if (document.body && document.body.dataset.demo === '1') {
  const pingDemo = () => {
    fetch('/demo/heartbeat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    }).catch(() => {});
  };

  pingDemo();
  window.setInterval(pingDemo, 15000);

  // A tab that was hidden and comes back says so at once, rather than waiting up to
  // fifteen seconds for the next tick.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      pingDemo();
    }
  });
}

// ---------------------------------------------------------------------- toast
// One short lived message, replaced by whatever the next step has to say. The
// upload is the only thing here that takes long enough to need reassuring.
let toastHideTimer = null;

function showToast(message, kind = 'info', { sticky = false } = {}) {
  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.className = `toast ${kind}`;
  toast.hidden = false;
  window.requestAnimationFrame(() => toast.classList.add('visible'));

  window.clearTimeout(toastHideTimer);

  if (sticky) {
    return;
  }

  toastHideTimer = window.setTimeout(() => {
    toast.classList.remove('visible');
    toastHideTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 220);
  }, kind === 'err' ? 7000 : 4500);
}

// ------------------------------------------------- upload change summary
/**
 * How an upload moved one account's list, in the order somebody reads it: what went, what
 * arrived, and what was only re-counted.
 *
 * A refresh is an item that was already there whose quantity the file reports differently -
 * a stack that grew or shrank. It is deliberately not called added or removed, because the
 * item itself stayed.
 */
function uploadChangeSummary(account) {
  const say = (count, word) => {
    const number = Math.max(0, Math.trunc(Number(count) || 0));

    return `${number} item${number === 1 ? '' : 's'} ${word}`;
  };

  return [
    say(account.removedItems, 'removed'),
    say(account.addedItems, 'added'),
    say(account.refreshedItems, 'refreshed'),
  ].join(', ');
}
// ---------------------------------------------- end upload change summary

// --------------------------------------------------------------------- upload
// Dropping a file or picking one both upload straight away: there is no button to
// press and nothing to confirm first.
async function uploadFile(file) {
  if (!file) {
    return;
  }

  // The card on a demo account says uploading is switched off. Saying so here costs
  // nothing and spares a file being sent to an answer that is already known.
  const restriction = document.getElementById('demoUploadNotice');

  if (restriction) {
    showToast(restriction.textContent.replace(/\s+/g, ' ').trim(), 'err');

    if (fileInput) {
      fileInput.value = '';
    }
    if (fileName) {
      fileName.textContent = 'No file selected';
    }

    return;
  }

  if (fileName) {
    fileName.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
  }
  if (dropZone) {
    dropZone.classList.add('busy');
  }

  showToast(`Received ${file.name} - uploading and processing...`, 'info', { sticky: true });

  try {
    const body = new FormData();
    body.append('savedvars', file);

    const response = await fetch('/upload', { method: 'POST', body });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || `Upload failed with status ${response.status}`);
    }

    const accounts = result.accounts || [];
    const icons = result.iconLookup && result.iconLookup.resolved
      ? `Found ${result.iconLookup.resolved} icon${result.iconLookup.resolved === 1 ? '' : 's'} that were missing.`
      : '';

    showToast(
      [
        `${file.name} has been received.`,
        ...accounts.map(
          (account) => `${account.accountName}: ${account.itemCount} item${account.itemCount === 1 ? '' : 's'}, quantity ${account.totalQuantity}`
        ),
        // What the file did to that list: an item nobody had before, an item only re-counted,
        // an item gone. A refresh is a quantity that went up or down on an item that stayed.
        ...accounts.map((account) => `  ${uploadChangeSummary(account)}`),
        // An item with requests still open was not refreshed from this file, so the
        // count on screen is the one the requests were made against.
        ...(result.heldBack || []).map(
          (item) =>
            `Pending requests for ${item.itemName} (${item.requests}), so its inventory was not refreshed.`
        ),
        // An account in the file that belongs to somebody else was left out, so say which
        // ones were not touched rather than letting the upload look complete.
        ...(result.skippedAccounts || []).map(
          (account) => `${account.accountName}: not updated - ${account.reason}.`
        ),
        icons,
      ]
        .filter(Boolean)
        .join('\n'),
      'ok'
    );

    refreshAfterChange();
  } catch (error) {
    showToast(error.message, 'err');
  } finally {
    if (dropZone) {
      dropZone.classList.remove('busy');
    }
    // Clearing the input means the same file can be chosen again straight away.
    if (fileInput) {
      fileInput.value = '';
    }
    if (fileName) {
      fileName.textContent = 'No file selected';
    }
  }
}

if (dropZone && fileInput) {
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) {
      uploadFile(file);
    }
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('dragging');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragging');
    });
  });

  dropZone.addEventListener('drop', (event) => {
    const dropped = event.dataTransfer && event.dataTransfer.files;
    if (dropped && dropped.length > 0) {
      uploadFile(dropped[0]);
    }
  });
}

// A file can be dropped anywhere on the site, not only on the card that asks for it.
//
// The card is drawn on two pages; the file is the same file wherever the reader happens to
// be, and walking back to the card to hand it over is a step with nothing behind it. Two
// things have to be true for it to work anywhere: the browser's own reaction is stopped
// (left alone it leaves the page and shows the .lua as text), and the drop is handed to the
// same uploadFile the card uses, so there is one upload path and one set of answers.
//
// The card's zone keeps its own listeners: it stops the browser itself, so the page-wide
// handler sees a drop it has already dealt with and leaves it alone.
const dropOverlayCard = `
    <span class="drop-overlay-title">Drop to upload</span>
    <span class="drop-overlay-file">GuildsBountySavedVars.lua</span>`;

let dropOverlay = null;
let dragDepth = 0;

function carryingFiles(event) {
  const types = (event.dataTransfer && event.dataTransfer.types) || [];

  return Array.from(types).includes('Files');
}

// Once, the first time a file is carried over the page: a page that never sees a drag
// never grows the element.
function dropOverlayElement() {
  if (!dropOverlay) {
    dropOverlay = document.createElement('div');
    dropOverlay.id = 'dropOverlay';
    dropOverlay.className = 'drop-overlay';
    dropOverlay.setAttribute('aria-hidden', 'true');
    dropOverlay.innerHTML = dropOverlayCard;
    document.body.appendChild(dropOverlay);
  }

  return dropOverlay;
}

function showDropOverlay(show) {
  dropOverlayElement().hidden = !show;

  if (!show) dragDepth = 0;
}

document.addEventListener('dragenter', (event) => {
  if (event.defaultPrevented || !carryingFiles(event)) return;

  event.preventDefault();
  // Every element the pointer crosses counts its own enter and leave, so the overlay is
  // taken away when the last of them has been left rather than on the first brush past.
  dragDepth += 1;
  showDropOverlay(true);
});

document.addEventListener('dragover', (event) => {
  if (!carryingFiles(event)) return;

  event.preventDefault();

  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('dragleave', (event) => {
  if (!carryingFiles(event)) return;

  dragDepth = Math.max(0, dragDepth - 1);

  if (dragDepth === 0) showDropOverlay(false);
});

document.addEventListener('drop', (event) => {
  // The upload card's own zone has taken this one already.
  if (event.defaultPrevented || !carryingFiles(event)) return;

  event.preventDefault();
  showDropOverlay(false);

  const dropped = event.dataTransfer && event.dataTransfer.files;
  const file = dropped && dropped[0];

  if (!file) return;

  // The same files the card accepts: the addon writes one .lua, and a .txt copy of it is
  // just as readable. Anything else is said plainly rather than sent to be refused.
  if (!/\.(lua|txt)$/i.test(file.name || '')) {
    showToast(
      `${file.name || 'That file'} is not a saved variables file - drop GuildsBountySavedVars.lua from your Saved Variables folder.`,
      'err'
    );
    return;
  }

  // Signing in, and not being a demo account, is what an upload needs. Both are answered
  // here so a drop on a page that has no card to explain it still says why.
  if (document.body.dataset.guestRequest === '1') {
    showToast('Sign in with Discord or Google before uploading.', 'err');
    return;
  }

  if (document.body.dataset.demo === '1') {
    const notice = document.getElementById('demoUploadNotice');

    showToast(
      notice
        ? notice.textContent.replace(/\s+/g, ' ').trim()
        : 'Uploading is switched off on a demo account, so this file would not be read and nothing in it would be saved.',
      'err'
    );
    return;
  }

  uploadFile(file);
});

// The avatar menu and the broken-photo fallback are in /header-menu.js: they are the
// header's own behaviour, and every page needs them, including the ones that do not load
// this file because they have no item list to script.

// Live item lists.
//
// socket.io only ever says "something you can see has changed"; the list itself
// comes back over the ordinary signed-in request, so the server still decides what
// may be on screen and this file never has to know the visibility rules.
//
// Redrawing a long table under someone's eyes and dumping them back at the top is
// worse than a stale row, so every row carries data-item-key. The row crossing a
// line a third of the way down the viewport is remembered before the swap and the
// page is scrolled by the difference afterwards. If that item is gone, the row that
// moved up into its place is used, so the reader drops one item down the list
// instead of losing their spot entirely.

// Match siblings by their server identity, then reconcile only changed leaves.
// Keys are scoped to a parent: the same request can appear in separate tables.
function liveNodeKey(node) {
  if (node.nodeType !== 1) return null;
  for (const name of ['id', 'data-item-key', 'data-request-id', 'data-filter-option', 'data-panel', 'data-tab', 'data-sort', 'data-group-heading']) {
    if (node.hasAttribute(name)) return `${node.tagName}:${name}:${node.getAttribute(name)}`;
  }
  if (node.matches('input[data-filter]')) return `INPUT:${node.name}:${node.type === 'checkbox' ? node.value : ''}`;
  if (node.matches('option')) return `OPTION:${node.value}`;
  return null;
}

function reconcileLiveNode(current, next) {
  if (current.nodeType !== 1) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  // These values belong to this browser, not to the server's initial rendering.
  const localTime = current.matches('time[data-since], time[data-local-time]') &&
    current.getAttribute('datetime') === next.getAttribute('datetime');
  const keepAttribute = (name) =>
    (localTime && name === 'title') ||
    (current.hasAttribute('data-panel') && name === 'hidden') ||
    (current.hasAttribute('data-tab') && ['aria-selected', 'tabindex'].includes(name)) ||
    (current.matches('details') && name === 'open') ||
    (current.matches('.live-pill') && ['hidden', 'data-live'].includes(name));
  for (const attribute of Array.from(current.attributes)) {
    if (!next.hasAttribute(attribute.name) && !keepAttribute(attribute.name)) {
      if (attribute.name === 'class' && current.classList.contains('row-fading')) continue;
      current.removeAttribute(attribute.name);
    }
  }
  for (const attribute of Array.from(next.attributes)) {
    if (keepAttribute(attribute.name)) continue;
    let value = attribute.value;
    if (attribute.name === 'class' && current.classList.contains('row-fading')) {
      value = [...new Set([...value.split(/\s+/).filter(Boolean), 'row-fading'])].join(' ');
    }
    if (current.getAttribute(attribute.name) !== value) current.setAttribute(attribute.name, value);
  }
  if (localTime || current.matches('.live-pill')) return;
  reconcileLiveChildren(current, next);
}

function reconcileLiveChildren(current, next) {
  const oldChildren = Array.from(current.childNodes);
  const keyed = new Map(oldChildren.map(node => [liveNodeKey(node), node]).filter(([key]) => key));
  const used = new Set();
  let cursor = current.firstChild;
  for (const incoming of Array.from(next.childNodes)) {
    // A dismissed basket row must never be resurrected by a later refresh.
    if (incoming.nodeType === 1 && incoming.matches('[data-basket-row]') &&
        removedRequestRows.has(incoming.dataset.requestId) &&
        !oldChildren.some(node => node.nodeType === 1 && node.dataset.requestId === incoming.dataset.requestId && node.classList.contains('row-fading'))) continue;
    const key = liveNodeKey(incoming);
    const compatible = node => node && node.nodeType === incoming.nodeType &&
      (node.nodeType !== 1 || node.tagName === incoming.tagName);
    let match = key ? keyed.get(key) : null;
    if (!key) {
      match = oldChildren.find(node => !used.has(node) && !liveNodeKey(node) && compatible(node));
    }
    if (!compatible(match) || used.has(match)) match = null;
    if (match) {
      used.add(match);
      reconcileLiveNode(match, incoming);
      if (match !== cursor) current.insertBefore(match, cursor);
      cursor = match.nextSibling;
    } else {
      const inserted = incoming.cloneNode(true);
      current.insertBefore(inserted, cursor);
    }
  }
  for (const node of oldChildren) {
    if (!used.has(node) && !(node.nodeType === 1 && node.matches('[data-basket-row]') &&
        node.dataset.status !== 'draft' && closingRequestRows.has(node.dataset.requestId)) &&
        !(node.nodeType === 1 && node.classList.contains('row-fading'))) node.remove();
  }
}

const listRegion = document.getElementById('itemLists');

if (listRegion) {
  const ANCHOR_LINE_RATIO = 0.35;
  const ANCHOR_LINE_MAX = 280;
  const CHANGE_DELAY_MS = 120;
  const SEARCH_DELAY_MS = 250;
  // The list's own search waits longer than the filter card's: it is typed into while
  // reading, and a word is usually several keystrokes, so a second lets the word finish
  // before the table redraws underneath it.
  const LIST_SEARCH_DELAY_MS = 1000;
  const RELOAD_ANCHOR_KEY = 'guildsbounty:scroll-anchor';
  const TAB_KEY = 'guildsbounty:tab';

  let liveState = 'wait';
  let refreshing = false;
  let queued = false;
  let timer = null;
  let everConnected = false;
  // Discard list responses that started before a successful bag mutation.
  let basketRevision = 0;
  let activeTab = 'request';
  // Each list has its own search: a word typed while reading My Inventory says nothing
  // about Browse Offers, and emptying one must leave the other as it was. My Requests and
  // Requests Received carry one too, and each narrows both tables on its tab.
  let listSearchByTab = { request: '', offer: '', mine: '', received: '' };
  let listSearchTimer = null;

  // The names each list's filters travel under, read by the menus, the chips and the two
  // numbers that count a list's rows. It sits up here with the rest of the page's state
  // rather than beside the handlers: the first thing the page does is put the remembered tab
  // on screen, and that already counts a menu, so a `const` declared further down would still
  // be in its dead zone and the whole page would stop there.
  //
  // One row per list. Browse Offers and My Inventory each keep their own choices under their
  // own names, so a type narrowed on what other people share never hides rows inside your own
  // bag, and switching tabs shows the tab's own filters. My Requests and Requests Received
  // have no row at all: a type or an owner says nothing about a request.
  const FILTER_PARAMS = {
    request: { type: 'type', owner: 'owner', added: 'added' },
    offer: { type: 'mtype', owner: 'mowner', added: 'madded' },
  };

  // What the list is drawn from, filters and all. It is kept here rather than read back from
  // the address bar, because the bar is not where a choice belongs: picking a type used to
  // leave `?type=...&owner=...` sitting in it, to be read, copied or bookmarked by accident.
  // A link that arrives with filters is read once, on load, and then left behind.
  let liveSearch = (() => {
    const params = new URLSearchParams(window.location.search);
    ['tab', 'answered', 'waiting', 'historyPage'].forEach((name) => params.delete(name));

    return params.toString() ? `?${params.toString()}` : '';
  })();

  // The names that only ever lead into the page - a tab to open, the answered flag an email
  // link carries, a page of Already sent - plus every filter. Each is read on load, so each
  // is taken back out of the bar once the page has drawn itself.
  const TRANSIENT_PARAMS = [
    ...new Set(Object.values(FILTER_PARAMS).flatMap((map) => Object.values(map))),
    'tab',
    'answered',
    'waiting',
    'historyPage',
  ];

  /** The bar's query with those names taken out. Pure, so the rule can be tried on its own. */
  function cleanBarQuery(search, names) {
    const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));

    names.forEach((name) => params.delete(name));

    return params.toString();
  }

  /** Leaves whatever is not ours in the bar - `?demo=1`, a campaign name - and nothing else. */
  function cleanAddressBar() {
    if (!window.history || !window.history.replaceState) {
      return;
    }

    const query = cleanBarQuery(window.location.search, TRANSIENT_PARAMS);
    const path = window.location.pathname;
    const clean = `${path}${query ? `?${query}` : ''}`;

    if (clean !== `${path}${window.location.search}`) {
      window.history.replaceState(null, '', clean);
    }
  }

  // Which page of Already sent is on screen. It is kept here rather than in the address
  // bar: paging is a view of the same page, so it must not rewrite the URL, count as a
  // navigation, or move the reader to a different tab.
  let liveHistoryPage = Number(new URLSearchParams(window.location.search).get('historyPage')) || null;

  try {
    const stored = window.sessionStorage.getItem(TAB_KEY);
    if (stored === 'request' || stored === 'offer' || stored === 'mine' || stored === 'received') {
      activeTab = stored;
    }
  } catch (error) {
    // No storage: the request tab is the default, which is also the useful one.
  }

  const anchorLine = () => Math.min(window.innerHeight * ANCHOR_LINE_RATIO, ANCHOR_LINE_MAX);

  function setLiveState(state) {
    liveState = state;
    const labels = { live: 'Live', wait: 'Reconnecting', off: 'Not live' };

    listRegion.querySelectorAll('.live-pill').forEach((pill) => {
      if (pill.hidden) pill.hidden = false;
      if (pill.dataset.live !== state) pill.dataset.live = state;
      const text = labels[state] || state;
      if (pill.textContent !== text) pill.textContent = text;
    });
  }

  // ---------------------------------------------------------------------- tabs
  // Others Inventory and My Inventory are the same data cut two ways, so the tab is a display
  // choice the server does not need to know about. It survives a live refresh (the
  // region is re-rendered from the Request tab) and a page rebuild.
  function setTab(name, { focus = false } = {}) {
    const tabs = Array.from(listRegion.querySelectorAll('[data-tab]'));
    const panels = Array.from(listRegion.querySelectorAll('[data-panel]'));

    if (!tabs.some((tab) => tab.dataset.tab === name)) {
      return;
    }

    activeTab = name;

    tabs.forEach((tab) => {
      const selected = tab.dataset.tab === name;
      if (tab.getAttribute('aria-selected') !== String(selected)) tab.setAttribute('aria-selected', String(selected));
      if (tab.tabIndex !== (selected ? 0 : -1)) tab.tabIndex = selected ? 0 : -1;

      if (selected && focus) {
        tab.focus();
      }
    });

    panels.forEach((panel) => {
      const hidden = panel.dataset.panel !== name;
      if (panel.hidden !== hidden) panel.hidden = hidden;
    });

    try {
      window.sessionStorage.setItem(TAB_KEY, name);
    } catch (error) {
      // Tab choice is a convenience; failing to remember it changes nothing.
    }

    // Each tab carries its own box, already holding that tab's word, and its own table for
    // the word to narrow: a tab switch is a switch of both, not a carry-over. A keystroke
    // still inside the second-long wait belongs to the tab being left, so it is dropped
    // rather than fired against the tab that replaced it.
    window.clearTimeout(listSearchTimer);
    // The filter row belongs to the list being drawn, so it moves with the tab - and leaves
    // the page on the two tabs whose tables no type or owner filter speaks for. This comes
    // first: the two rows are drawn together, and showing the right one must not depend on
    // the narrowing below finishing.
    syncFilterCard();
    applyListSearch();
  }

  listRegion.addEventListener('click', (event) => {
    const closest = (selector) => (event.target.closest ? event.target.closest(selector) : null);
    const tab = closest('[data-tab]');

    if (tab) {
      event.preventDefault();
      setTab(tab.dataset.tab, { focus: true });
      return;
    }

    const historyPage = closest('a[data-history-page]');
    if (historyPage) {
      // Leave modified clicks to the browser so pages can still open in another tab.
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const url = new URL(historyPage.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      // Only the list is replaced. The address bar keeps what it had and the tab being
      // read stays selected, so turning a page does not look like a move to another page.
      liveHistoryPage = Number(url.searchParams.get('historyPage')) || 1;
      scheduleRefresh(0);
      return;
    }

    // A column heading is one place in the sort queue and a press moves it: a column that
    // is off joins the end ascending, one already there reverses where it stands, and a
    // third press takes it out. The queue is remembered in a cookie instead of the address
    // bar, so a shared link never carries somebody else's sorting.
    const sortButton = closest('[data-sort]');

    if (sortButton) {
      event.preventDefault();
      cycleSort(sortButton.dataset.sort);
      scheduleRefresh(0);
      return;
    }

    // The little cross at the end of the search box empties it and puts the list back.
    const clearSearch = closest('[data-list-search-clear]');

    if (clearSearch) {
      event.preventDefault();
      const tab = clearSearch.getAttribute('data-list-search-clear') || activeTab;
      listSearchByTab[tab] = '';
      window.clearTimeout(listSearchTimer);
      applyListSearch(tab);

      const panel = listRegion.querySelector(`[data-panel="${tab}"]`);
      const input = (panel || listRegion).querySelector('[data-list-search]');
      if (input) input.focus();
      return;
    }

    // Grouping is the other half of how the list reads: whether the type headings are
    // drawn at all. It is kept apart from the sort so turning it off leaves the order
    // alone, and turning it on does not throw away the column somebody picked.
    const groupButton = closest('[data-group-toggle]');

    if (groupButton) {
      event.preventDefault();
      // The switch says which list it belongs to, so pressing it changes that list alone.
      writeGroupCookie(
        groupButton.getAttribute('data-group-list') || 'request',
        groupButton.getAttribute('aria-pressed') === 'true' ? '0' : '1'
      );
      scheduleRefresh(0);
      return;
    }

    // The same fold, for every type at once. The button says which list it sits on, so the
    // press moves that list only - Browse Offers and My Inventory are read separately.
    const foldAll = closest('[data-fold-all]');

    if (foldAll) {
      event.preventDefault();
      foldEveryType(foldAll);
      return;
    }

    // A type heading folds the rows beneath it away. They are already on the page, so this
    // opens and closes them without asking the server; which types are folded is a reading
    // choice about one list, so it goes in that list's own cookie and survives a refresh.
    const typeToggle = closest('[data-type-toggle]');

    if (typeToggle) {
      event.preventDefault();
      const list = typeToggle.getAttribute('data-group-list') || 'request';
      const type = typeToggle.getAttribute('data-type-toggle');
      const heading = typeToggle.closest('.type-row');

      if (heading) {
        const shut = !heading.classList.contains('is-collapsed');

        setTypeFolded(list, type, shut);
        heading.classList.toggle('is-collapsed', shut);
        typeToggle.setAttribute('aria-expanded', String(!shut));

        if (shut) {
          for (const row of groupMembers(heading)) row.hidden = true;
        } else {
          // The rows come back first, so opening a type never depends on anything else
          // succeeding; the search box then narrows them again if it holds a word.
          for (const row of groupMembers(heading)) row.hidden = false;
          applyListSearch(list);
        }
      }

      return;
    }

    const requestButton = closest('[data-request]');

    if (requestButton) {
      event.preventDefault();

      // One copy is not a choice. A stack of one, or the last copy of a bigger stack,
      // leaves exactly one possible answer, so the click sends it instead of opening a
      // dialog whose only option is "one". A standing offer is the same case.
      //
      // Except for somebody the site has not met: the dialog is the only place the ESO
      // account and the address are asked for, so it opens even for one copy. Skipping it
      // sent a request with no person behind it, and the answer was a toast telling them
      // to say things they had never been asked.
      const available = Math.max(1, Number(requestButton.dataset.max) || 1);

      if (available <= 1 && !document.body.dataset.guestRequest) {
        sendRequest({
          kind: requestButton.dataset.kind === 'offer' ? 'offer' : 'inventory',
          id: requestButton.dataset.id,
          quantity: 1,
          name: requestButton.dataset.name || 'that item',
        });
        return;
      }

      openRequestDialog(requestButton);
      return;
    }

    const cancelButton = closest('[data-cancel-request]');

    if (cancelButton) {
      event.preventDefault();
      cancelOwnRequest(cancelButton);
    }
  });

  listRegion.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    const tabs = Array.from(listRegion.querySelectorAll('[data-tab]'));
    const index = tabs.findIndex((tab) => tab.dataset.tab === activeTab);

    if (index === -1) {
      return;
    }

    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : tabs.length - 1;
    setTab(tabs[(index + step) % tabs.length].dataset.tab, { focus: true });
  });

  // A link can name the tab it wants - the request email's "open Requests Received" does - and
  // that beats the remembered one: somebody who followed a link asked for that tab, while the
  // remembered one is only what they happened to look at last.
  const asked = new URLSearchParams(window.location.search).get('tab');

  if (asked === 'request' || asked === 'offer' || asked === 'mine' || asked === 'received') {
    activeTab = asked;
  }

  if (new URLSearchParams(window.location.search).has('historyPage')) activeTab = 'mine';
  // An answer given on the Requests Received tab comes back to the list carrying what it
  // recorded, and that confirmation is drawn on the tab: opening it is the point of the
  // redirect. Read from the address rather than from storage, so it works on a first visit,
  // in a private window and on whatever device the email was opened on.
  if (new URLSearchParams(window.location.search).has('answered')) activeTab = 'received';
  setTab(activeTab);

  // A request email lands here to be answered, so its link also says which table to bring up:
  // the waiting list, rather than the tab strip with the completed history below the fold.
  if (new URLSearchParams(window.location.search).get('waiting') === '1') {
    const waiting = document.getElementById('receivedWaiting');

    if (waiting) waiting.scrollIntoView({ block: 'start' });
  }
  window.addEventListener('popstate', () => {
    liveHistoryPage = Number(new URLSearchParams(window.location.search).get('historyPage')) || null;
    setTab('mine');
    scheduleRefresh(0);
  });

  // -------------------------------------------------------------------- the search
  // The box under the tabs narrows the rows already on the page - no request, so it
  // answers before a round trip could. Each tab carries its own word, and a word only ever
  // narrows the list it was typed over. Group headings take no part in the matching: a
  // heading is a label for the rows under it, so it stays while any of them match and goes
  // when none do, rather than disappearing because the word typed is not the type's own
  // name. The filter card above keeps its search, which is a name filter the server applies
  // and the address bar carries.
  function applyListSearch(tab = activeTab) {
    // Each tab draws its own box and its own table, so the narrowing stops at that panel.
    // The other tab keeps every row it had, and its own word, for when it comes back. A tab
    // with two tables - My Requests and Requests Received - narrows both of them: the word is
    // about the item, and which half of the tab a row is in does not make it a different item.
    const panel = listRegion.querySelector(`[data-panel="${tab}"]`);
    const scope = panel || listRegion;
    const typed = listSearchByTab[tab];
    const term = typed.trim().toLowerCase();
    const input = scope.querySelector('[data-list-search]');
    const clear = scope.querySelector('[data-list-search-clear]');

    // A refresh can put a fresh box in place. It is given the text that is filtering the
    // list rather than left empty while the rows below stay narrowed for no visible reason.
    if (input && input.value !== typed) input.value = typed;
    if (clear) clear.hidden = typed === '';

    for (const body of scope.querySelectorAll('table tbody')) {
      const groups = [];
      let group = null;

      for (const row of Array.from(body.rows)) {
        if (row.classList.contains('type-row')) {
          // A folded heading stays shut while a word is typed: its rows are not on screen
          // to narrow, and the count beside it still says how many are waiting there.
          group = { row, total: 0, shown: 0, shut: row.classList.contains('is-collapsed') };
          groups.push(group);
          continue;
        }

        if (!row.hasAttribute('data-search')) continue;

        const matches =
          term === '' || row.getAttribute('data-search').toLowerCase().includes(term);

        row.hidden = !matches || Boolean(group && group.shut);
        // A fold hides a row without taking it out of the list; a word the row does not
        // contain does. The mark is what tells a count which of the two happened, so folding
        // a type still counts its rows and searching does not.
        if (matches) {
          row.removeAttribute('data-search-miss');
        } else {
          row.setAttribute('data-search-miss', '');
        }

        if (!group) continue;

        group.total += 1;
        if (matches) group.shown += 1;
      }

      // Decided after the rows are counted, because a heading is drawn before them. A
      // folded one stays whatever the word: it is the way back to its rows.
      for (const entry of groups) {
        entry.row.hidden = !entry.shut && entry.shown === 0;

        // The number beside a type is the server's count of the whole group, and while a
        // search is narrowing the rows under it that number is a lie. While a word is on, it
        // counts the rows that survived the word - what is on screen - and goes back to the
        // plain total once the word is cleared.
        const count = entry.row.querySelector('.type-count');

        if (count) {
          count.textContent = term === '' ? `(${entry.total})` : `(${entry.shown})`;
        }
      }
    }

    // The word changed which rows are on the page, so every number that counts them is read
    // again: the tabs, the menu beside the search, and the headings above the rows.
    syncCounts();
  }

  /**
   * What each type's menu entry counts: the rows of that type on the page.
   *
   * Read back from the rows rather than from what the page was first sent, because the rows
   * are what changed - a live push, a search - and the number beside a type has to follow
   * them or it is describing a list the reader is not looking at.
   *
   * The choices themselves are never touched. A list narrowed by its own filter row is a
   * slice of the list, not the list, and counting the slice said every type the reader had
   * not chosen had nothing in it - so choosing one type emptied the menu of all the others
   * and left no way back to them. What a list can offer is the server's to decide: it draws
   * these menus from every row the list has, whatever the filters are, so a type really has
   * to be gone from the list before it leaves the box.
   */
  function syncTypeCounts() {
    for (const form of filterForms()) {
      const list = filterListOf(form);
      const name = (FILTER_PARAMS[list] || {}).type;

      if (!name) continue;

      // A filtered list is a slice, so its rows cannot speak for the menu: the numbers stay
      // the ones the server drew from the whole list.
      if (listHasFilter(list)) continue;

      const menu = Array.from(form.querySelectorAll('[data-filter-menu]')).find((entry) =>
        entry.querySelector(`input[data-filter][name="${name}"]`)
      );

      if (!menu) continue;

      const counts = new Map();

      // A folded row is still a row, so folding a type does not change its number; a row a
      // word has hidden, or one that has left the page - a push, an offer that ran out - is
      // not counting towards anything the reader can see.
      for (const row of listRegion.querySelectorAll(
        `table[data-list="${list}"] tbody tr[data-type-name]`
      )) {
        if (row.hasAttribute('data-search-miss')) continue;

        const type = row.getAttribute('data-type-name');

        if (type) counts.set(type, (counts.get(type) || 0) + 1);
      }

      // A list with no rows at all says nothing about the types it has; its menus are left
      // exactly as the server drew them.
      if (counts.size === 0) continue;

      for (const box of menu.querySelectorAll(`input[data-filter][name="${name}"]`)) {
        const option = box.closest('.filter-option');
        const count = option ? option.querySelector('.filter-option-count') : null;

        if (count) count.textContent = `(${counts.get(box.value) || 0})`;
      }
    }
  }

  /**
   * Whether the list is narrowed by its own filter row right now.
   *
   * Read from what the list is drawn from, not from the address bar: the bar is cleaned of
   * filter names as soon as they are used, so it can never say what is narrowing the list. An
   * empty value is the "any" end of a menu, which is the same as having made no choice at all.
   */
  function listHasFilter(list) {
    const names = Object.values(FILTER_PARAMS[list] || {});
    const params = new URLSearchParams(liveSearch);

    return names.some((name) => params.getAll(name).some((value) => String(value).trim() !== ''));
  }

  function updateSearchClear(tab) {
    const panel = listRegion.querySelector(`[data-panel="${tab}"]`);
    const clear = (panel || listRegion).querySelector('[data-list-search-clear]');

    if (clear) clear.hidden = (listSearchByTab[tab] || '') === '';
  }

  /**
   * The number on each tab: the rows that tab is showing right now.
   *
   * Read from the rows rather than from what the page was first sent, so the number moves
   * with the list - a push that adds or drops a row, a word that hides some - and goes back
   * to the whole list when the word is cleared. A folded row is still a row the tab holds, so
   * folding a type does not move its tab's number.
   */
  function syncTabCounts() {
    for (const tab of Array.from(listRegion.querySelectorAll('[data-tab]'))) {
      const name = tab.dataset.tab;
      const count = tab.querySelector('.tab-count');
      const rows = listRegion.querySelectorAll(`[data-counts-tab="${name}"]`);

      // A tab with nothing of its own - the requests tabs on somebody who has none - keeps
      // the number the server sent rather than being told it has none by a count of zero.
      if (!count || rows.length === 0) continue;

      let shown = 0;

      for (const row of rows) {
        if (!row.hasAttribute('data-search-miss')) shown += 1;
      }

      count.textContent = String(shown);
    }
  }

  /** Every number that counts rows, in one pass. */
  function syncCounts() {
    syncTabCounts();
    syncTypeCounts();
  }

  listRegion.addEventListener('input', (event) => {
    const field = event.target.closest ? event.target.closest('[data-list-search]') : null;

    if (!field) return;

    // The box says which list it belongs to, so the word lands on that list even if the
    // tab has moved on between the keystroke and this handler.
    const tab = field.getAttribute('data-list-search');

    if (!(tab in listSearchByTab)) return;

    // The field keeps up with every keystroke; the list waits for the word. Narrowing on
    // the first letter would hide rows and move the table on the way to the right four.
    listSearchByTab[tab] = field.value;
    updateSearchClear(tab);

    window.clearTimeout(listSearchTimer);
    listSearchTimer = window.setTimeout(() => applyListSearch(tab), LIST_SEARCH_DELAY_MS);
  });

  // ------------------------------------------------------------------- filters
  // Filters apply as soon as they change - there is no button to forget - and the
  // address bar keeps up, so a reload or a live refresh uses the same filters.
  let filterSearchTimer = null;

  function filterForms() {
    return Array.from(document.querySelectorAll('[data-filters]'));
  }

  function filterListOf(form) {
    return form && form.dataset.filterList === 'offer' ? 'offer' : 'request';
  }

  /** The row belonging to the tab in front of the reader, or null on a tab with no filters. */
  function activeFilterForm() {
    if (activeTab !== 'request' && activeTab !== 'offer') {
      return null;
    }

    const list = activeTab === 'offer' ? 'offer' : 'request';

    return filterForms().find((form) => filterListOf(form) === list) || null;
  }

  /**
   * Which row is on screen, and whether the card is drawn at all.
   *
   * The card is rendered once by the server, so this runs on every tab change and after every
   * live refresh: a push can replace the rows without knowing which tab is open. A list with
   * nothing to choose - an account with no rows yet - takes the whole card away rather than
   * showing three menus with one option each.
   */
  function syncFilterCard() {
    const card = document.getElementById('itemFilters');
    const shown = activeFilterForm();

    filterForms().forEach((form) => {
      const on = form === shown;
      if (form.hidden !== !on) form.hidden = !on;
    });

    if (card) {
      const empty = !shown || shown.dataset.filterEmpty === '1';
      if (card.hidden !== empty) card.hidden = empty;
    }
  }

  // The sort order is a reading preference, so it is remembered in a cookie and never
  // written into the address bar. An empty queue means "no choice": the plain type
  // grouping the server sends anyway, which also clears a choice made on an earlier visit.
  // Its own cookie, for the same reason: a display choice should not be in the URL, and
  // the two choices are independent, so one must not overwrite the other.
  // One cookie per list. Browse Offers keeps the name it has always used; My Inventory has its
  // own, so the two can be grouped differently and each switch reports the list it sits on.
  // Keyed by the tab's own name: `request` is Browse Offers, `offer` is My Inventory. Not
  // `mine`, which is the My Requests tab, draws no type headings, and answers to a different
  // panel - the mistake that made opening a folded type leave its rows hidden.
  const GROUP_COOKIES = { request: 'guildsbounty_group', offer: 'guildsbounty_group_mine' };

  function writeGroupCookie(list, value) {
    const name = GROUP_COOKIES[list] || GROUP_COOKIES.request;

    document.cookie = `${name}=${encodeURIComponent(
      value
    )}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  // Which types are folded away, one cookie per list, for the same reason the grouping has
  // two: Browse Offers and My Inventory are read separately and must not move each other.
  const FOLDED_COOKIES = { request: 'guildsbounty_collapsed', offer: 'guildsbounty_collapsed_mine' };

  // The names are written escaped and split on the commas between them, so a blank cookie
  // means nothing is folded - which is how every list starts.
  function readFoldedTypes(list) {
    const name = FOLDED_COOKIES[list] || FOLDED_COOKIES.request;

    return readCookieValue(name)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function setTypeFolded(list, type, shut) {
    const name = FOLDED_COOKIES[list] || FOLDED_COOKIES.request;
    const types = readFoldedTypes(list).filter((entry) => entry !== type);

    if (shut) types.push(type);

    document.cookie = `${name}=${types
      .map((entry) => encodeURIComponent(entry))
      .join(',')}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  // Every type in one list opens or shuts in one press. Named rather than written inline in
  // the click handler so the test can hand it a real document: it is the only place that has
  // to keep five things in step - the headings, their rows, their carets, the cookie, and the
  // words on the button that started it.
  function foldEveryType(button) {
    const list = button.getAttribute('data-group-list') || 'request';
    // What the press does, not what the list is: shut means "fold them all away".
    const shut = button.getAttribute('data-fold-all-shut') === 'true';
    // Only this list's headings, and only inside the panel it lives in, so one tab's press
    // cannot reach into another tab's table.
    const scope = button.closest('[data-panel]') || document;
    const headings = [...scope.querySelectorAll(`[data-type-toggle][data-group-list="${list}"]`)]
      .map((toggle) => toggle.closest('.type-row'))
      .filter(Boolean);

    setAllTypesFolded(
      list,
      headings.map((heading) => heading.querySelector('[data-type-toggle]').getAttribute('data-type-toggle')),
      shut
    );

    for (const heading of headings) {
      const toggle = heading.querySelector('[data-type-toggle]');

      heading.classList.toggle('is-collapsed', shut);
      toggle.setAttribute('aria-expanded', String(!shut));

      for (const row of groupMembers(heading)) row.hidden = shut;
    }

    // The words say what the next press would do, so they turn over with the list.
    button.setAttribute('data-fold-all-shut', String(!shut));
    button.title = shut ? 'Open every type at once' : 'Fold every type away at once';

    const word = button.querySelector('.fold-all-word');

    if (word) word.textContent = shut ? 'Expand all' : 'Collapse all';

    // Opened rows then meet whatever is in the search box, so an unfold cannot leave rows on
    // screen that the word typed in the box had hidden.
    if (!shut) applyListSearch(list);
  }

  // One write for the whole list: shut writes every type it drew, open clears the cookie
  // rather than leaving a set behind that the headings no longer agree with.
  function setAllTypesFolded(list, types, shut) {
    const name = FOLDED_COOKIES[list] || FOLDED_COOKIES.request;
    const written = shut ? types : [];

    document.cookie = `${name}=${written
      .map((entry) => encodeURIComponent(entry))
      .join(',')}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  // The rows a type heading covers: everything between it and the heading after it.
  function groupMembers(heading) {
    const rows = [];

    for (
      let next = heading.nextElementSibling;
      next && !next.classList.contains('type-row');
      next = next.nextElementSibling
    ) {
      if (next.tagName === 'TR') rows.push(next);
    }

    return rows;
  }

  function writeSortCookie(value) {
    document.cookie = `guildsbounty_sort=${encodeURIComponent(
      value
    )}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  // The order is a queue of columns, written as `name:asc,type:desc`: the first decides,
  // the next only breaks its ties, and so on in the order they were pressed. Only the
  // cycling happens here - the server reads the queue back (lib/sortQueue.js) and draws
  // the rows already sorted, so a refresh never leaves the table half ordered.
  const SORT_FIELDS = ['name', 'added', 'type', 'trait', 'location', 'owner'];

  function readCookieValue(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function readSortQueue() {
    const order = [];

    for (const part of readCookieValue('guildsbounty_sort').split(',')) {
      const [field, dir] = part.split(':').map((piece) => piece.trim());

      if (!SORT_FIELDS.includes(field) || (dir !== 'asc' && dir !== 'desc')) continue;
      if (order.some((entry) => entry.field === field)) continue;

      order.push({ field, dir });
    }

    return order;
  }

  // One press: off joins the end ascending, ascending reverses in place, descending takes
  // the column out and everything behind it moves up a place.
  function cycleSort(field) {
    if (!SORT_FIELDS.includes(field)) return;

    const order = readSortQueue();
    const at = order.findIndex((entry) => entry.field === field);
    let next;

    if (at === -1) {
      next = [...order, { field, dir: 'asc' }];
    } else if (order[at].dir === 'asc') {
      next = order.map((entry, index) => (index === at ? { field, dir: 'desc' } : entry));
    } else {
      next = order.filter((entry, index) => index !== at);
    }

    writeSortCookie(next.map((entry) => `${entry.field}:${entry.dir}`).join(','));
  }

  // A filter can hold several values, and what is switched on is shown as chips
  // under the row, so the controls and the chips are built from one place.
  function chosenValues(form, name) {
    const values = [];

    if (!form) {
      return values;
    }

    form.querySelectorAll(`[data-filter][name="${name}"]`).forEach((field) => {
      // Radios carry Added's single window; an unchecked one is simply not part of it.
      if (field.type === 'checkbox' || field.type === 'radio') {
        if (field.checked && field.value) {
          values.push(field.value);
        }
        return;
      }

      const value = String(field.value || '').trim();

      if (value) {
        values.push(value);
      }
    });

    return values;
  }

  function renderFilterChips(form) {
    const row = form ? form.querySelector('[data-filter-chips]') : null;

    if (!row) {
      return;
    }

    row.textContent = '';
    const names = FILTER_PARAMS[filterListOf(form)];

    [names.type, names.owner].forEach((name) => {
      chosenValues(form, name).forEach((value) => {
        // The chip is a label; only the × beside it is a button, so the word cannot be
        // clicked away by accident.
        const chip = document.createElement('span');
        chip.className = 'filter-chip';
        chip.append(document.createTextNode(value));

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'filter-chip-remove';
        remove.dataset.chipFilter = name;
        remove.dataset.chipValue = value;
        remove.title = `Remove the ${value} filter`;
        remove.setAttribute('aria-label', `Remove the ${value} filter`);

        const cross = document.createElement('span');
        cross.setAttribute('aria-hidden', 'true');
        cross.textContent = '\u00d7';
        remove.appendChild(cross);

        chip.appendChild(remove);
        row.appendChild(chip);
      });
    });
  }

  // Each menu says how many of its values are on, so a closed menu still answers
  // whether it is doing anything.
  function renderFilterMenus(form) {
    if (!form) {
      return;
    }

    form.querySelectorAll('[data-filter-menu]').forEach((menu) => {
      const checked = Array.from(menu.querySelectorAll('input[data-filter]')).filter(
        (box) => box.checked
      );
      const label = menu.querySelector('.filter-select-label');
      const badge = menu.querySelector('.filter-count');
      const allLabel = menu.dataset.allLabel || 'All';

      if (label) {
        // The word on the summary is the option's own label, not its value: LAST CHANCE
        // is stored as `last-chance` and would otherwise be read back in lower case.
        label.textContent =
          checked.length === 0
            ? allLabel
            : checked.length === 1
              ? checked[0].closest('.filter-option')?.querySelector('[data-filter-label]')
                  ?.textContent || checked[0].value
              : `${checked.length} chosen`;
      }
      if (badge) {
        badge.textContent = String(checked.length);
        badge.hidden = checked.length === 0;
      }
    });
  }

  function applyFilters(form = activeFilterForm()) {
    if (!form) {
      return;
    }

    const names = FILTER_PARAMS[filterListOf(form)];
    const own = Object.values(names);

    // The item name is not here any more: the list's own search box narrows the rows on
    // the page, so nothing about it belongs in the request.
    //
    // Only this list's names are rewritten. The other list keeps what it was left with, which
    // is the whole point of the two rows: its filters are its own business.
    //
    // The choice goes into `liveSearch`, which the next request is drawn from, and the bar is
    // cleaned of every filter name instead of being written to. A viewer who copies the address
    // of a filtered list gets the site, not their own search.
    const want = new URLSearchParams(liveSearch);

    own.forEach((name) => want.delete(name));
    own.forEach((name) => {
      chosenValues(form, name).forEach((value) => want.append(name, value));
    });

    renderFilterChips(form);
    renderFilterMenus(form);

    // A new filter is a new list, so it starts at the first page rather than at whichever
    // page of the previous list happened to be open.
    liveHistoryPage = null;
    want.delete('historyPage');

    liveSearch = want.toString() ? `?${want.toString()}` : '';

    cleanAddressBar();

    scheduleRefresh(0);
  }

  // Every row is handled from the document rather than from each form, because a live refresh
  // can replace a form's markup while the reader is using it.
  document.addEventListener('change', (event) => {
    const form = event.target.closest ? event.target.closest('[data-filters]') : null;

    if (!form || !event.target.matches('[data-filter]')) {
      return;
    }

    // The menu stays open. A filter row is a handful of boxes ticked in one sitting - two
    // types, a type and an owner - and closing on the first one means hunting the box down
    // again for every other. It closes when the click lands outside it, further down.

    applyFilters(form);
  });

  // Typing filters as it is typed, just slowly enough not to fetch on every key.
  document.addEventListener('input', (event) => {
    const form = event.target.closest ? event.target.closest('[data-filters]') : null;

    if (!form || !event.target.matches('input[type="search"][data-filter]')) {
      return;
    }

    window.clearTimeout(filterSearchTimer);
    filterSearchTimer = window.setTimeout(() => applyFilters(form), SEARCH_DELAY_MS);
  });

  // Filters apply as they change, so the button is only there for a browser without scripts.
  document.addEventListener('submit', (event) => {
    const form = event.target.closest ? event.target.closest('[data-filters]') : null;

    if (!form) {
      return;
    }

    event.preventDefault();
    applyFilters(form);
  });

  document.addEventListener('click', (event) => {
    const form = event.target.closest ? event.target.closest('[data-filters]') : null;

    // A chip removes its own value and leaves the rest of the filters alone.
    const chip = event.target.closest ? event.target.closest('[data-chip-filter]') : null;

    if (chip && form) {
      event.preventDefault();

      form.querySelectorAll(`[data-filter][name="${chip.dataset.chipFilter}"]`).forEach((field) => {
        if (field.type === 'checkbox' && field.value === chip.dataset.chipValue) {
          field.checked = false;
        } else if (field.tagName === 'SELECT' && field.value === chip.dataset.chipValue) {
          field.value = '';
        }
      });

      applyFilters(form);
      return;
    }

    const clearButton = event.target.closest ? event.target.closest('[data-clear-filters]') : null;

    if (clearButton && form) {
      event.preventDefault();

      form.querySelectorAll('[data-filter]').forEach((field) => {
        if (field.type === 'checkbox' || field.type === 'radio') {
          field.checked = false;
        } else {
          field.value = '';
        }
      });

      applyFilters(form);
      return;
    }

    // A click outside a menu closes it, so two open menus never sit over each other while
    // the reader is trying to use the one underneath.
    document.querySelectorAll('[data-filters] details[open]').forEach((menu) => {
      if (!menu.contains(event.target)) {
        menu.open = false;
      }
    });
  });

  filterForms().forEach((form) => {
    renderFilterChips(form);
    renderFilterMenus(form);
  });
  syncFilterCard();
  // A link that arrives with its filters chosen is drawn once - `liveSearch` has already read
  // them - and then leaves them behind, so the bar shows the page and nothing more.
  cleanAddressBar();

  // -------------------------------------------------------- keeping the place
  // The row the reader is looking at: the first one crossing the anchor line. Null
  // when the list is off screen, because then nothing on it has to hold its place.
  function captureAnchor() {
    const rows = Array.from(listRegion.querySelectorAll('tr[data-item-key]'));

    if (rows.length === 0) {
      return null;
    }

    const line = anchorLine();
    let index = rows.length - 1;

    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].getBoundingClientRect().bottom > line) {
        index = i;
        break;
      }
    }

    const rect = rows[index].getBoundingClientRect();

    if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
      return null;
    }

    return { key: rows[index].dataset.itemKey, index, offset: rect.top - line };
  }

  function restoreAnchor(anchor) {
    if (!anchor) {
      return;
    }

    const rows = Array.from(listRegion.querySelectorAll('tr[data-item-key]'));

    if (rows.length === 0) {
      return;
    }

    const match = rows.find((row) => row.dataset.itemKey === anchor.key);
    // Removed item: the row that moved up into its slot is the next one down.
    const target = match || rows[Math.min(anchor.index, rows.length - 1)];
    const delta = target.getBoundingClientRect().top - anchorLine() - anchor.offset;

    if (Math.abs(delta) >= 1) {
      window.scrollBy(0, delta);
    }
  }

  function rememberAcrossReload(anchor) {
    try {
      window.sessionStorage.setItem(RELOAD_ANCHOR_KEY, JSON.stringify(anchor));
    } catch (error) {
      // Private mode or storage turned off: a rebuild simply starts at the top.
    }
  }

  // The bar is the only part of the header that depends on the basket, so it is the only
  // part that has to be rebuilt when the basket changes. The last item leaving takes it
  // away outright: a clock and a warning about unsent items mean nothing once nothing is
  // waiting, and the next item added brings it back.
  let headerBarFetching = false;
  let headerBasket = null;
  let basketChangeQueue = Promise.resolve();

  // Keep mutation responses in the same order as the clicks that produced them.
  // Otherwise a slower cancellation can restore a snapshot taken before the last one.
  function lockBasketChanges() {
    const ready = basketChangeQueue;
    let release;
    basketChangeQueue = new Promise((resolve) => { release = resolve; });
    return ready.then(() => release);
  }

  async function syncHeaderBar(heldNow, summary = { unique: 0, copies: 0 }, basket = null) {
    if (basket) {
      basket = { ...basket, deadline: Date.now() + Math.max(0, basket.secondsLeft) * 1000 };
    }
    headerBasket = { heldNow, summary, basket };
    if (basket?.holdMinutes) {
      document.body.dataset.holdMinutes = String(basket.holdMinutes);
    }
    const current = document.querySelector('[data-basket]');

    if (!heldNow) {
      if (current) {
        current.remove();
      }
      return;
    }

    // Adds and removals reset the server's clock. Use its new remaining time too.
    if (current) {
      updateHeaderBar(current, summary);
      updateBasketClock(current, basket);
      tickCountdown();
      return;
    }

    if (current || headerBarFetching) {
      return;
    }

    headerBarFetching = true;

    try {
      const response = await fetch(window.location.pathname + window.location.search, {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
        cache: 'no-store',
      });

      if (!response.ok) {
        return;
      }

      const template = document.createElement('template');
      template.innerHTML = await response.text();
      const bar = template.content.querySelector('[data-basket]');
      const after = document.querySelector('.top-bar-left');

      // Only if it is still missing: a slower answer must not add a second clock over a
      // bar an earlier one already put back.
      if (bar && after && headerBasket.heldNow && !document.querySelector('[data-basket]')) {
        updateHeaderBar(bar, headerBasket.summary);
        updateBasketClock(bar, headerBasket.basket);
        after.insertAdjacentElement('afterend', bar);
        tickCountdown();
      }
    } catch (error) {
      // Offline. The next refresh asks again.
    } finally {
      headerBarFetching = false;
    }
  }

  function applyRegion(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    const next = template.content.querySelector('#itemLists');

    if (!next) {
      // The viewer has no list any more, so the page around it has to go too.
      window.location.reload();
      return;
    }

    const anchor = captureAnchor();
    // Prepare newly inserted controls with this browser's state before attachment.
    next.querySelectorAll('[data-tab]').forEach(tab => {
      const selected = tab.dataset.tab === activeTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    next.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== activeTab; });
    next.querySelectorAll('.live-pill').forEach(pill => {
      pill.hidden = false;
      pill.dataset.live = liveState;
      pill.textContent = { live: 'Live', wait: 'Reconnecting', off: 'Not live' }[liveState] || liveState;
    });

    // The hold bar sits in the header, outside this region, so a change in what is being
    // held cannot be shown by swapping the list alone. Only that bar is rebuilt: reloading
    // the page instead threw away anything half-typed and asked the browser's own "leave
    // this page?" question, which is how sending a basket used to end.
    // Every refresh reconciles the bar, not only one where its presence differs: the two
    // numbers on it move as items are added, topped up or removed, and an empty bag takes
    // the whole bar away.
    const heldRows = Array.from(next.querySelectorAll('[data-basket-row][data-status="draft"]'));

    syncHeaderBar(heldRows.length > 0, {
      unique: heldRows.length,
      copies: heldRows.reduce(
        (sum, row) => sum + (Number(row.dataset.requestQuantity) || 1),
        0
      ),
    }, {
      secondsLeft: Number(next.dataset.basketSeconds) || 0,
      holdMinutes: Number(next.dataset.holdMinutes) || 5,
    });

    const rowTops = captureRowTops(listRegion);
    const panelHeights = Array.from(listRegion.querySelectorAll('[data-panel]')).map((panel) =>
      panel.getBoundingClientRect().height
    );

    reconcileLiveNode(listRegion, next);
    // The block comes back from the server expanded; a reader who folded it keeps it folded.
    applyListTopState(listRegion);

    restoreAnchor(anchor);
    animatePanelHeights(listRegion, panelHeights);
    animateRowsInto(listRegion, rowTops);
    localiseTimeLabels(listRegion);
    relativeTick(listRegion);
    noteClosedRequests();
    syncRequestDialog();
    syncFilterCard();
    applyListSearch();
    // The rows are new, so the numbers that count them are read back off the page: a menu
    // that still says what it said before the push is the one thing a reader cannot check.
    syncCounts();
  }

  /**
   * Which page of Already sent the list should ask for: the one being read, or the one
   * the address bar arrived with. In one place, so the request and the "are these new
   * cancellations?" check cannot disagree about which page is on screen.
   */
  function listHistoryPage() {
    return (
      liveHistoryPage || Number(new URLSearchParams(window.location.search).get('historyPage')) || 1
    );
  }

  /** The filters the list is drawn from, with the page being read added in. */
  function listQuery() {
    const params = new URLSearchParams(liveSearch);
    const page = listHistoryPage();

    if (page > 1) {
      params.set('historyPage', String(page));
    } else {
      params.delete('historyPage');
    }

    const query = params.toString();

    return query ? `?${query}` : '';
  }

  async function refresh() {
    if (refreshing) {
      queued = true;
      return;
    }

    refreshing = true;
    const revision = basketRevision;
    const query = listQuery();

    try {
      const response = await fetch(`/items${query}`, {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
        cache: 'no-store',
      });

      if (response.ok) {
        const html = await response.text();
        if (revision === basketRevision && query === listQuery()) {
          applyRegion(html);
        } else {
          queued = true;
        }
      }
    } catch (error) {
      // Offline, or the server is restarting: the next reconnect refreshes.
    } finally {
      refreshing = false;

      if (queued) {
        queued = false;
        scheduleRefresh();
      }
    }
  }

  function scheduleRefresh(delay = CHANGE_DELAY_MS) {
    if (timer) {
      return;
    }

    timer = window.setTimeout(() => {
      timer = null;
      refresh();
    }, delay);
  }

  refreshListsSoon = (delay = 0) => scheduleRefresh(delay);

  // ---------------------------------------------------------------- requests
  // The button carries how many this person may end up holding, their own basket
  // included, so the dialog can offer the rest of a stack that is partly theirs
  // already: one, or everything they can hold, and the second only when it is more
  // than one - a number nobody could check is not worth asking for.
  let dialog = null;
  let dialogState = null;
  const knownClosed = new Set();
  let requestsPrimed = false;
  let closedHistoryPage = new URLSearchParams(window.location.search).get('historyPage') || '1';

  function escapeText(value) {
    const node = document.createElement('span');
    node.textContent = String(value || '');
    return node.innerHTML;
  }

  function closeRequestDialog() {
    if (dialog) {
      dialog.remove();
      dialog = null;
    }

    dialogState = null;
    document.removeEventListener('keydown', onDialogKey);
  }

  function onDialogKey(event) {
    if (event.key === 'Escape') {
      closeRequestDialog();
    }
  }

  // How many copies this person may still claim on one row: the ones nobody has
  // reserved. Their own basket is not added in, because RESERVED already counts it and
  // asking again adds to that row instead of starting a second one.
  function dialogNumbers(button) {
    if (!button) {
      return { max: 0, stack: 0, held: 0 };
    }

    const stack = Math.max(1, Number(button.dataset.stack) || 1);
    const max = Math.min(stack, Math.max(0, Number(button.dataset.max) || 0));
    const held = Math.max(0, Number(button.dataset.held) || 0);

    return { max, stack, held };
  }

  /**
   * A copy count the controls can actually show: a whole number from 1 to the number
   * left. Typed text that is not a number, a fraction, or more than there is, all come
   * back as something the slider has a position for.
   */
  function clampCopies(value, max) {
    const cap = Math.max(1, Math.trunc(Number(max) || 1));
    const wanted = Math.trunc(Number(value) || 1);

    return Math.min(cap, Math.max(1, wanted));
  }

  function dialogSummary(state) {
    if (state.kind === 'offer') {
      return 'This is a standing offer, so it means one copy.';
    }

    if (state.max < 1) {
      return 'Every copy has just been reserved, so there is nothing left to ask for.';
    }

    return `${state.max}${state.stack > state.max ? ` of the ${state.stack}` : ''} still available${
      state.held > 0
        ? `, and ${state.held} already in your basket - asking for more adds to that row rather than starting another`
        : ''
    }.`;
  }

  // The same password box the page's forms draw (lib/views.js), built here because this
  // dialog is assembled after the page has loaded. `/password-toggle.js` listens on the
  // document rather than on each box, so the eye works on these too.
  function passwordBox({ id, label, name, hint = '' }) {
    return `
          <div class="auth-field">
            <label for="${id}">${escapeText(label)}</label>
            <span class="password-field" data-password-field>
              <input id="${id}" type="password" name="${name}" autocomplete="new-password"
                     minlength="8" maxlength="200" required>
              <button class="password-toggle" type="button" data-reveal-password
                      aria-pressed="false" aria-label="Show the password" title="Show the password">
                <svg class="password-eye" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M1.75 12S5.6 5.5 12 5.5 22.25 12 22.25 12 18.4 18.5 12 18.5 1.75 12 1.75 12Z"
                        fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                  <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.7"/>
                </svg>
                <svg class="password-eye-off" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M2.5 2.5 21.5 21.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                  <path d="M9.9 5.9A10.6 10.6 0 0 1 12 5.5c6.4 0 10.25 6.5 10.25 6.5a18.4 18.4 0 0 1-3.9 4.4M6.1 7.7A18 18 0 0 0 1.75 12S5.6 18.5 12 18.5a10.9 10.9 0 0 0 3.9-.7"
                        fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                </svg>
              </button>
            </span>
            ${hint ? `<span class="auth-hint">${escapeText(hint)}</span>` : ''}
          </div>`;
  }

  function openRequestDialog(button) {
    const kind = button.dataset.kind === 'offer' ? 'offer' : 'inventory';
    const numbers = dialogNumbers(button);
    const name = button.dataset.name || 'that item';
    const choices = kind === 'inventory' && numbers.max > 1;
    const state = { kind, id: button.dataset.id, name, ...numbers };

    closeRequestDialog();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    // The first request from somebody who has not signed in carries everything a request
    // needs: the ESO account it is made from, an address to answer, and a password so the
    // request can be found again later. Together they make a real account, so the second
    // request asks nothing and the sign-in card lets them back in.
    // Somebody signed in who has not attached an ESO account yet is asked for the one
    // name the request needs, and nothing else: the address and the sign-in already
    // exist, so asking for them again would be asking a question they answered.
    const accountOnlyFields = `
      <div class="guest-fields">
        <label class="auth-field">
          <span>ESO account name</span>
          <input type="text" name="accountName" autocomplete="off" spellcheck="false"
                 maxlength="96" placeholder="@YourAccountName" required>
        </label>
        <p class="auth-hint">The character the request is made from. It is attached to this sign-in, so you are only asked once.</p>
      </div>`;
    const guestFields = document.body.dataset.guestRequest
      ? `
        <div class="guest-fields">
          <label class="auth-field">
            <span>ESO account name</span>
            <input type="text" name="accountName" autocomplete="off" spellcheck="false"
                   maxlength="96" placeholder="@YourAccountName" required>
          </label>
          <label class="auth-field">
            <span>Email address</span>
            <input type="email" name="email" autocomplete="email" spellcheck="false"
                   maxlength="254" placeholder="you@example.com" required>
          </label>
          ${passwordBox({ id: 'guest-password', label: 'Password', name: 'password' })}
          ${passwordBox({ id: 'guest-confirm', label: 'Type it again', name: 'confirm' })}
          <p class="auth-hint dialog-note" data-dialog-note hidden></p>
          <p class="auth-hint">Asked once. These make an account: the request is made from that character, the answer goes to that address, and the password is how you sign back in to see it.</p>
        </div>`
      : document.querySelector('[data-needs-account]')
        ? accountOnlyFields
        : '';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="requestTitle">
        <h2 id="requestTitle">Reserve ${escapeText(name)}</h2>
        <p class="muted" data-dialog-summary>${escapeText(dialogSummary(state))}</p>
        ${guestFields}
        ${
          choices
            ? `<div class="reserve-picker">
          <input class="reserve-slider" type="range" min="1" max="${state.max}" step="1" value="1"
                 data-reserve-slider aria-label="Copies to reserve, 1 to ${state.max}">
          <input class="reserve-amount" type="number" min="1" max="${state.max}" step="1" value="1"
                 inputmode="numeric" data-reserve-amount aria-label="Copies to reserve">
        </div>`
            : ''
        }
        <div class="modal-actions reserve-actions">
          <button class="round-button is-cancel" type="button" data-close-dialog
                  title="Cancel" aria-label="Cancel">&#10005;</button>
          <button class="round-button is-confirm" type="button" data-reserve-confirm
                  title="Reserve" aria-label="Reserve">&#10003;</button>
        </div>
      </div>`;

    document.body.appendChild(backdrop);
    dialog = backdrop;
    dialogState = state;
    document.addEventListener('keydown', onDialogKey);

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || (event.target.closest && event.target.closest('[data-close-dialog]'))) {
        closeRequestDialog();
      }
    });

    // One answer, and the number in it belongs to the person: a slider from one copy to
    // everything still available, with a box showing the same number that can be typed
    // into. Whole copies only, and never more than are left.
    const ask = () => {
      const amount = backdrop.querySelector('[data-reserve-amount]');
      const accountName = backdrop.querySelector('input[name="accountName"]');
      const email = backdrop.querySelector('input[name="email"]');
      const password = backdrop.querySelector('input[name="password"]');
      const confirm = backdrop.querySelector('input[name="confirm"]');
      const note = backdrop.querySelector('[data-dialog-note]');

      // One sentence in the dialog rather than a silent move of the caret: a password
      // typed twice and disagreed is a typo somebody has to be told about.
      const say = (message, field) => {
        if (note) {
          note.textContent = message;
          note.hidden = false;
        }

        if (field) {
          field.focus();
        }
      };

      if (note) {
        note.hidden = true;
      }

      // Nothing is sent until all of it is there: the request would have no character to
      // come from, no address to be answered at, and no way back in. A 400 after closing
      // the dialog is a worse way to learn that than the caret in the empty box.
      if (accountName && !accountName.value.trim()) {
        accountName.focus();
        return;
      }

      if (email && !email.value.trim()) {
        email.focus();
        return;
      }

      // The browser's minlength only guards a form submit, and this is a button click, so
      // the length the server will insist on is checked here too.
      if (password && password.value.length < 8) {
        say('Use a password of at least 8 characters.', password);
        return;
      }

      // Two boxes, because this makes an account: a typo in the only one would lock the
      // person out of the answers they are being promised an address for.
      if (password && confirm && confirm.value !== password.value) {
        say('Those two passwords are not the same.', confirm);
        return;
      }

      // The row moves while the dialog is open - somebody else claims a copy, the owner
      // uploads a smaller count - so what is left is read again at the moment of asking.
      // A number that no longer fits is clamped to the new top, and once every copy has
      // gone nothing is sent at all: the dialog stays open and says so.
      refreshDialogNumbers();

      if (dialogState.max < 1) {
        syncRequestDialog();
        return;
      }

      const picked = {
        kind,
        id: button.dataset.id,
        quantity: choices ? clampCopies(amount ? amount.value : 1, dialogState.max) : 1,
        name,
        accountName: accountName ? accountName.value.trim() : '',
        email: email ? email.value.trim() : '',
        password: password ? password.value : '',
        confirm: confirm ? confirm.value : '',
      };

      closeRequestDialog();
      sendRequest(picked);
    };

    const confirmButton = backdrop.querySelector('[data-reserve-confirm]');

    if (confirmButton) {
      confirmButton.addEventListener('click', () => ask());
      confirmButton.focus();
    }

    const slider = backdrop.querySelector('[data-reserve-slider]');
    const amountBox = backdrop.querySelector('[data-reserve-amount]');

    if (slider && amountBox) {
      // The two controls are one answer: moving either moves the other, and the box is
      // held to whole copies the slider has a position for rather than being allowed to
      // drift to a number that cannot be chosen.
      const limit = Math.max(1, dialogState ? dialogState.max : 1);
      const setCopies = (value) => {
        const copies = clampCopies(value, limit);
        slider.value = String(copies);

        return copies;
      };

      slider.addEventListener('input', () => {
        amountBox.value = String(setCopies(slider.value));
      });

      amountBox.addEventListener('input', () => {
        const digits = amountBox.value.replace(/[^\d]/g, '');

        if (digits !== amountBox.value) {
          amountBox.value = digits;
        }

        if (digits) {
          slider.value = String(clampCopies(digits, limit));
        }
      });

      // A number the slider cannot hold snaps to the nearest it can on the way out of the
      // box, so what is sent is always one of the slider's own values.
      amountBox.addEventListener('change', () => {
        amountBox.value = String(setCopies(amountBox.value));
      });

      amountBox.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          ask();
        }
      });
    }
  }

  /**
   * Re-reads the row the dialog was opened from. The list under the dialog keeps moving,
   * so the number left comes from the row again rather than from when the dialog opened.
   * A row with nothing left is not in the list at all - "All held" stands where its
   * button was - and that reads here as nothing left.
   */
  function refreshDialogNumbers() {
    if (!dialogState) {
      return null;
    }

    const fresh = document.querySelector(
      `[data-request][data-kind="${dialogState.kind}"][data-id="${dialogState.id}"]`
    );
    const numbers = dialogNumbers(fresh);

    dialogState.max = numbers.max;
    dialogState.stack = numbers.stack;
    dialogState.held = numbers.held;

    return dialogState;
  }

  /**
   * Keeps an open dialog honest while the list under it moves: when somebody else
   * claims a copy, the number left, the top of the slider and the cap on the box all
   * follow it down, without making the person close and reopen the dialog.
   */
  function syncRequestDialog() {
    if (!dialog || !dialogState) {
      return;
    }

    refreshDialogNumbers();

    const summary = dialog.querySelector('[data-dialog-summary]');

    if (summary) {
      summary.textContent = dialogSummary(dialogState);
    }

    const nothingLeft = dialogState.max < 1;
    const cap = String(Math.max(1, dialogState.max));
    const slider = dialog.querySelector('[data-reserve-slider]');
    const amountBox = dialog.querySelector('[data-reserve-amount]');

    // The ceiling can fall while the dialog is open, so both controls follow it and a
    // number that no longer fits snaps to the new top.
    if (slider) {
      slider.max = cap;
      slider.disabled = nothingLeft;
      slider.value = String(clampCopies(slider.value, dialogState.max));
    }

    if (amountBox) {
      amountBox.max = cap;
      amountBox.disabled = nothingLeft;

      if (Number(amountBox.value) > dialogState.max) {
        amountBox.value = cap;
      }
    }

    const confirmButton = dialog.querySelector('[data-reserve-confirm]');

    if (confirmButton) {
      confirmButton.disabled = nothingLeft;
    }
  }

  // A reservation is not a request. The copy leaves everyone else's list the moment it is
  // picked, but no owner is asked until the basket is sent - so the difference is said at
  // the moment the first copy goes into an empty basket. Somebody who reads the click as
  // the request itself walks away, and the hold simply lapses.
  //
  // This used to be once per browser session, tracked in sessionStorage, which is why it
  // could not be seen: any earlier hold in that tab set the flag for good, however long
  // ago it was and whatever had happened to that basket since. Tying it to the empty
  // basket says it at the moment the confusion is actually possible, and only then.

  function holdMinutes() {
    // The bar is drawn from the basket the server just read, so it carries the number the
    // hold really is. The body attribute is the same number on a page with no bar, and 5
    // is only a last resort for a page that predates either.
    const bar = document.querySelector('[data-basket]');
    const fromBar = bar ? Number(bar.dataset.holdMinutes) : 0;

    return Math.max(1, fromBar || Number(document.body.dataset.holdMinutes) || 5);
  }

  /** What the bag holds right now: different items, and copies in all. */
  function basketSummary() {
    if (headerBasket) return headerBasket.summary;
    const bar = document.querySelector('[data-basket]');

    if (bar) {
      return {
        unique: Number(bar.dataset.items) || 0,
        copies: Number(bar.dataset.copies) || Number(bar.dataset.items) || 0,
      };
    }

    const rows = Array.from(document.querySelectorAll('[data-basket-row][data-status="draft"]'));

    return {
      unique: rows.length,
      copies: rows.reduce((sum, row) => sum + (Number(row.dataset.requestQuantity) || 1), 0),
    };
  }

  /** Keeps the bar's two numbers honest when the list changes underneath it. */
  function updateHeaderBar(bar, { unique, copies }) {
    const label = bar.querySelector('.draft-basket-text strong');

    if (label) {
      const text = `${unique} unique item${unique === 1 ? '' : 's'} (${copies} total) reserved`;
      if (label.textContent !== text) label.textContent = text;
    }

    if (bar.dataset.items !== String(unique)) bar.dataset.items = String(unique);
    if (bar.dataset.copies !== String(copies)) bar.dataset.copies = String(copies);
  }

  function updateBasketClock(bar, basket) {
    if (!basket) return;
    bar.dataset.holdMinutes = String(basket.holdMinutes);
    bar.dataset.seconds = String(basket.secondsLeft);
    bar.dataset.deadline = String(basket.deadline || Date.now() + Math.max(0, basket.secondsLeft) * 1000);
    delete bar.dataset.lapsed;
    const label = bar.querySelector('[data-countdown]');
    if (label) label.classList.remove('countdown-fading');
  }

  function explainFirstHold(name, copies) {
    const minutes = holdMinutes();
    const what = copies > 1 ? `${copies} copies of ${name}` : name;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="holdTitle">
        <h2 id="holdTitle" class="modal-title-bar">Reserved - not sent yet</h2>
        <p>${escapeText(what)} ${copies > 1 ? 'have' : 'has'} been reserved, but not sent yet.</p>
        <p class="muted">${copies > 1 ? 'Items' : 'Item'} will not be requested until you submit your request, your reservation will expire in ${minutes} minute${minutes === 1 ? '' : 's'}.</p>
        <div class="modal-actions">
          <button class="primary-button" type="button" data-close-hold>Keep looking</button>
          <button class="primary-button" type="button" data-send-hold>Send Requests</button>
        </div>
      </div>`;

    document.body.appendChild(backdrop);

    function onKey(event) {
      if (event.key === 'Escape') {
        close();
      }
    }

    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    };

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.closest('[data-close-hold]')) {
        close();
        return;
      }

      if (event.target.closest('[data-send-hold]')) {
        close();
        const button = document.querySelector('[data-submit-requests]');

        if (button) {
          button.click();
        } else {
          refreshAfterChange();
          showToast('Press Send Requests in the header to ask for it.', 'ok');
        }
      }
    });

    document.addEventListener('keydown', onKey);

    // Keep looking is the default answer: pressing Enter on this notice should not send a
    // request somebody only meant to look at.
    const keepLooking = backdrop.querySelector('[data-close-hold]');

    if (keepLooking) {
      keepLooking.focus();
    }
  }

  async function sendRequest({
    kind,
    id,
    quantity,
    name,
    accountName = '',
    email = '',
    password = '',
    confirm = '',
  }) {
    const release = await lockBasketChanges();
    // Read before the request goes, and read as a count: a bag with nothing in it is the
    // moment the notice is about, whether it has never held anything or was emptied a
    // moment ago. The quantity is settled by the dialog before this runs, so the copy that
    // is about to be added is the one being counted for.
    const basketWasEmpty = basketSummary().unique === 0;

    try {
      const payload = new URLSearchParams({ kind, id, quantity });

      if (accountName) {
        payload.set('accountName', accountName);
      }

      if (email) {
        payload.set('email', email);
      }

      if (password) {
        payload.set('password', password);
      }

      if (confirm) {
        payload.set('confirm', confirm);
      }

      const response = await fetch('/requests', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: payload,
      });
      const result = await response.json().catch(() => ({}));

      // A demo session is answered with the reason, not with a failure: the click was
      // understood, and nothing was written.
      if (result.demo) {
        showToast(result.error, 'err');
        return;
      }

      if (!response.ok) {
        throw new Error(result.error || `That request failed with status ${response.status}`);
      }

      // The first request made them a person, so the page stops asking: the fields were
      // only ever for somebody the site had never met.
      if (document.body.dataset.guestRequest) {
        delete document.body.dataset.guestRequest;
      }

      // The request attached the account to this sign-in, so the question is answered:
      // the marker goes, and the next refresh draws the region without it.
      document
        .querySelectorAll('[data-needs-account]')
        .forEach((marker) => marker.remove());

      // Asking again for something already in the basket tops that row up, so the
      // number that stuck is the one to report, not the one that was picked.
      const asked = Number(result.quantity) || quantity;

      basketRevision++;
      if (result.basket) {
        syncHeaderBar(result.basket.count > 0, {
          unique: result.basket.count,
          copies: result.basket.quantity,
        }, result.basket);
      }

      if (basketWasEmpty) {
        explainFirstHold(name, asked);
      }

      showToast(
        result.combined
          ? `Your basket now holds ${asked} of ${name}.`
          : asked > 1
            ? `Reserved ${asked} of ${name}.`
            : `Reserved ${name}.`,
        'ok'
      );
      refreshAfterChange();
    } catch (error) {
      showToast(error.message, 'err');
    } finally {
      release();
    }
  }

  async function cancelOwnRequest(button) {
    const release = await lockBasketChanges();
    try {
      const response = await fetch(`/requests/${encodeURIComponent(button.dataset.id)}/cancel`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || 'That request could not be cancelled.');
      }

      basketRevision++;
      const row = button.closest('[data-basket-row]');
      if (row) row.dataset.status = 'cancelled';
      if (result.basket) {
        syncHeaderBar(result.basket.count > 0, {
          unique: result.basket.count,
          copies: result.basket.quantity,
        }, result.basket);
      }
      showToast('Request cancelled.', 'ok');
      refreshAfterChange();
    } catch (error) {
      showToast(error.message, 'err');
    } finally {
      release();
    }
  }

  // A request can be closed by someone else's upload, which arrives as an ordinary
  // list refresh. The first pass only records what is already closed, so opening the
  // page does not announce history; after that, anything newly cancelled is news.
  function noteClosedRequests() {
    const page = String(listHistoryPage());
    const historyChanged = page !== closedHistoryPage;
    closedHistoryPage = page;
    const closed = Array.from(
      listRegion.querySelectorAll('[data-my-request][data-status="cancelled"]')
    );
    const fresh = [];

    for (const row of closed) {
      const id = row.dataset.requestId;

      if (!id || knownClosed.has(id)) {
        continue;
      }

      knownClosed.add(id);

      if (requestsPrimed && !(historyChanged && row.hasAttribute('data-history-row'))) {
        fresh.push(row);
      }
    }

    if (!requestsPrimed) {
      requestsPrimed = true;
      return;
    }

    if (fresh.length > 0) {
      showToast(
        fresh
          .map(
            (row) =>
              `Your request for ${row.dataset.requestName || 'an item'} was cancelled: ${
                row.dataset.requestReason || 'the owner no longer has it.'
              }`
          )
          .join('\n'),
        'err'
      );
    }
  }

  noteClosedRequests();

  // ------------------------------------------------------------ pending requests badge
  // The number on the avatar is drawn by the server along with the page, and a live refresh
  // of the list under it is a fragment, so nothing ever redrew the circle. This is the other
  // half: when an ask lands on something the signed-in person owns, the server tells their
  // own pages the new total and the circle is brought up to date in place.
  const PENDING_BADGE_CAP = 99;

  /**
   * What the badge should say for a count, and the two sentences that carry it to somebody
   * who cannot see the circle.
   *
   * Kept as one pure function because the wording has to match the page the server draws:
   * if the two drift, the count would appear to change when the page is reloaded.
   */
  function pendingBadgeState(count, name) {
    const waiting = Math.max(0, Math.trunc(Number(count) || 0));
    const said = `${waiting} request${waiting === 1 ? '' : 's'} to process`;

    return {
      waiting,
      badge:
        waiting === 0
          ? ''
          : waiting > PENDING_BADGE_CAP
            ? `${PENDING_BADGE_CAP}+`
            : String(waiting),
      title: waiting > 0 ? `${name} - ${said}` : name,
      label: `Account menu for ${name}${waiting > 0 ? `, ${said}` : ''}`,
    };
  }

  /** Draw the count where the server would have drawn it, without reloading anything. */
  function applyPendingBadge(count) {
    const button = document.getElementById('accountMenuButton');

    if (!button) {
      return;
    }

    const slot = button.querySelector('.avatar-slot');
    // The header draws no name of its own any more, so the button carries it as data - the
    // label it says out loud is built from the same word the page was drawn with.
    const state = pendingBadgeState(count, button.dataset.accountName || '');
    let badge = slot ? slot.querySelector('.avatar-badge') : null;

    if (!state.badge) {
      // Nothing waiting is no circle at all, the same as a page drawn with nothing waiting.
      if (badge) badge.remove();
    } else if (slot) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'avatar-badge';
        badge.setAttribute('aria-hidden', 'true');
        slot.append(badge);
      }
      badge.textContent = state.badge;
    }

    button.title = state.title;

    const said = button.querySelector('.visually-hidden');

    if (said) {
      said.textContent = state.label;
    }
  }
  // ------------------------------------------------------ end pending requests badge

  // ------------------------------------------------------------------- socket
  const socket = typeof window.io === 'function' ? window.io({ withCredentials: true }) : null;

  if (socket) {
    socket.on('connect', () => {
      setLiveState('live');

      // A reconnect may have missed changes while the tab was asleep or the server
      // was restarting, so the list is fetched once the link is back.
      if (everConnected) {
        scheduleRefresh(0);
      }
      everConnected = true;
    });

    socket.on('disconnect', () => setLiveState('wait'));
    socket.on('connect_error', () => setLiveState('wait'));
    socket.on('items:changed', (payload) => {
      scheduleRefresh();

      // The demo copy's guildmates act on their own, and until now what they had done was
      // only in the server's log. It is written into the demo banner rather than shown as a
      // toast: one of these arrives every fifteen seconds or so, and a toast that replaces
      // whatever the visitor is reading - including their own "3 copies reserved" - is
      // noise. The marker is only on demo pushes, so an ordinary page never shows one.
      if (payload && payload.demo && payload.message) {
        const line = document.querySelector('[data-demo-activity]');

        if (line) {
          line.textContent = payload.message;
          line.hidden = false;
        }
      }
    });
    // Addressed to this person only, and carrying the total rather than a change: two tabs
    // and a phone all end up showing the same number.
    socket.on('requests:pending', (payload) => {
      if (payload && typeof payload.count !== 'undefined') {
        applyPendingBadge(payload.count);
      }
    });
  } else {
    setLiveState('off');
  }

  // A rebuild for a changed filter list happens in a new page; put the reader back
  // on the row they were on rather than at the top.
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      let anchor = null;

      try {
        const raw = window.sessionStorage.getItem(RELOAD_ANCHOR_KEY);

        if (raw) {
          window.sessionStorage.removeItem(RELOAD_ANCHOR_KEY);
          anchor = JSON.parse(raw);
        }
      } catch (error) {
        anchor = null;
      }

      if (anchor) {
        restoreAnchor(anchor);
      }
    });
  }
}

// ------------------------------------------------------- unsent request basket
// A request holds its item before it is sent, so the clock matters twice: the person
// needs to see how long they have left, and walking away would strand a reservation
// nobody knows about. Both live here.

function basketHeldItems() {
  const basket = document.querySelector('[data-basket]');
  return basket ? Number(basket.dataset.items) || 0 : 0;
}

// The server sends the seconds left as it renders the page; from then on this counts
// down against the clock, so the number moves without one request per second. A live
// refresh replaces the element, which restarts it from whatever the server now says.
const COUNTDOWN_SOON_SECONDS = 60;
const COUNTDOWN_URGENT_SECONDS = 30;
const COUNTDOWN_FADE_MS = 2000;

function tickCountdown() {
  const basket = document.querySelector('[data-basket]');
  const label = basket ? basket.querySelector('[data-countdown]') : null;

  if (!basket || !label) {
    return;
  }

  if (!basket.dataset.deadline) {
    basket.dataset.deadline = String(Date.now() + (Number(basket.dataset.seconds) || 0) * 1000);
  }

  const remaining = Math.max(0, Math.round((Number(basket.dataset.deadline) - Date.now()) / 1000));
  const minutes = Math.floor(remaining / 60);

  label.textContent = `${minutes}:${String(remaining % 60).padStart(2, '0')}`;

  // Three stages rather than one alarm: yellow says start wrapping up, red says send
  // it now. The number is the same in all three, so colour is only emphasis.
  label.classList.toggle(
    'countdown-soon',
    remaining > COUNTDOWN_URGENT_SECONDS && remaining <= COUNTDOWN_SOON_SECONDS
  );
  label.classList.toggle('countdown-urgent', remaining <= COUNTDOWN_URGENT_SECONDS && remaining > 0);

  // Zero is when the server has already let the items go. Fading the clock out reads
  // as the reservation ending; snapping it away looks like a bug.
  if (remaining === 0 && !basket.dataset.lapsed) {
    basket.dataset.lapsed = '1';
    label.classList.remove('countdown-soon');
    label.classList.add('countdown-urgent', 'countdown-fading');
    showToast(
      'The time to send those requests ran out, so the items went back to being available.',
      'err'
    );
    window.setTimeout(refreshAfterChange, COUNTDOWN_FADE_MS);
  }
}

window.setInterval(tickCountdown, 1000);
tickCountdown();

async function sendBasket(button) {
  button.disabled = true;

  try {
    const response = await fetch('/requests/submit', {
      method: 'POST',
      credentials: 'same-origin',
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || 'Those requests could not be sent.');
    }

    const emailed =
      Number(result.emailed) > 0
        ? ` ${result.emailed} owner${result.emailed === 1 ? '' : 's'} emailed.`
        : '';

    showToast(
      `${result.sent === 1 ? 'Request sent.' : `${result.sent} requests sent.`}${emailed}`,
      'ok'
    );
    refreshAfterChange();
  } catch (error) {
    showToast(error.message, 'err');
  } finally {
    button.disabled = false;
  }
}

document.addEventListener('click', (event) => {
  const submit = event.target.closest ? event.target.closest('[data-submit-requests]') : null;

  if (submit) {
    event.preventDefault();
    sendBasket(submit);
  }
});

// ------------------------------------------------- requests waiting on your items
// The answering list used to be a page of its own, so opening it lost the item list and
// coming back was a full reload. It is fetched as a fragment and shown over the list
// instead: one small request to open it, one to answer a row, and the list underneath
// is already the right one to return to.
let ownerRequestsModal = null;

function closeOwnerRequestsModal() {
  if (ownerRequestsModal) {
    ownerRequestsModal.remove();
    ownerRequestsModal = null;
  }

  document.removeEventListener('keydown', onOwnerRequestsKey);
}

function onOwnerRequestsKey(event) {
  if (event.key === 'Escape') {
    closeOwnerRequestsModal();
  }
}

function ownerRequestsCard() {
  return ownerRequestsModal ? ownerRequestsModal.querySelector('[data-owner-requests]') : null;
}

function showOwnerRequestsCard(html) {
  if (!ownerRequestsModal) {
    return;
  }

  const modal = ownerRequestsModal.querySelector('.modal');

  if (!modal) {
    return;
  }

  modal.innerHTML = html;
  // The fragment arrives from the server, which can only write UTC; the reader's own
  // clock is put on it here, the same way the item list's times are done on load.
  localiseTimeLabels(modal);

  const close = modal.querySelector('[data-owner-requests-close]');

  if (close) {
    close.focus();
  }
}

async function fetchOwnerRequests(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'X-GuildsBounty-Fragment': '1',
      Accept: 'text/html',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error('My Requests could not be loaded. Nothing was changed.');
  }

  return response.text();
}

async function openOwnerRequests() {
  closeOwnerRequestsModal();

  const panel = document.getElementById('accountMenuPanel');
  const panelButton = document.getElementById('accountMenuButton');

  if (panel) {
    panel.hidden = true;
  }

  if (panelButton) {
    panelButton.setAttribute('aria-expanded', 'false');
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal modal-wide owner-modal" role="dialog" aria-modal="true" aria-label="Requests for your items">
      <p class="muted">Loading what is waiting on your items...</p>
    </div>`;
  document.body.appendChild(backdrop);
  ownerRequestsModal = backdrop;
  document.addEventListener('keydown', onOwnerRequestsKey);

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      closeOwnerRequestsModal();
    }
  });

  try {
    showOwnerRequestsCard(await fetchOwnerRequests('/owner/requests'));
  } catch (error) {
    closeOwnerRequestsModal();
    showToast(error.message, 'err');
  }
}

// A row answers itself: the form posts the same fields the page posts, but the reply is
// the list again rather than a redirect, so the modal keeps its place and the answered
// row is simply not in it any more.
async function answerOwnerRequest(form, submitter = null) {
  const buttons = Array.from(form.querySelectorAll('button'));

  buttons.forEach((button) => {
    button.disabled = true;
  });

  // Fulfilled and Not fulfilled are the same form, and which one was pressed is the whole
  // answer: the body carries the button's name and value, because a form on its own leaves
  // the submit button out. It is urlencoded rather than FormData on purpose - the server
  // reads urlencoded bodies, so a multipart one arrives empty and the row looks unanswered.
  const body = new URLSearchParams(new FormData(form));

  if (submitter && submitter.name) {
    body.set(submitter.name, submitter.value);
  }

  try {
    showOwnerRequestsCard(
      await fetchOwnerRequests('/owner/requests', { method: 'POST', body })
    );

    const card = ownerRequestsCard();
    const recorded = card ? card.querySelector('.status.ok') : null;

    if (recorded) {
      showToast(recorded.textContent.trim(), 'ok');
    }

    // The card names the house when the item just answered stands in one, where no bag can
    // recount it; the first such answer in a session says what to do about it.
    const placed = card ? card.querySelector('[data-house-rescan]') : null;

    if (placed) {
      noteHouseRescan(placed.getAttribute('data-house-rescan'));
    }

    refreshAfterChange();
  } catch (error) {
    buttons.forEach((button) => {
      button.disabled = false;
    });
    showToast(error.message, 'err');
  }
}

document.addEventListener('click', (event) => {
  if (event.target.closest && event.target.closest('[data-owner-requests-close]')) {
    event.preventDefault();
    closeOwnerRequestsModal();
    return;
  }

  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  const opener = event.target.closest ? event.target.closest('a[href="/owner/requests"]') : null;

  if (!opener || opener.target === '_blank') {
    return;
  }

  event.preventDefault();
  openOwnerRequests();
});

document.addEventListener('submit', (event) => {
  const form = event.target;

  if (!ownerRequestsModal || !form.closest || !form.closest('[data-owner-requests]')) {
    return;
  }

  if (form.getAttribute('action') !== '/owner/requests') {
    return;
  }

  event.preventDefault();
  answerOwnerRequest(form, event.submitter || null);
});

// ------------------------------------------- placed furnishings, once a session
// A placed furnishing is not in any bag, so nothing on this site can count it: the row
// reads "Placed (Mournoth Keep)" and its number stays what the last scan found, however
// many copies have been picked up since. Answering one is therefore a handover whose
// other half happens in the game, and the count of what is left has to come from a new
// scan. The first answer of a session for a placed item says so, once, not once per row.
const HOUSE_RESCAN_KEY = 'guildsbounty:house-rescan-notice';
let houseRescanNotice = null;

function closeHouseRescanNotice() {
  if (houseRescanNotice) {
    houseRescanNotice.remove();
    houseRescanNotice = null;
  }

  document.removeEventListener('keydown', onHouseRescanKey);
}

function onHouseRescanKey(event) {
  if (event.key === 'Escape') {
    closeHouseRescanNotice();
  }
}

function showHouseRescanNotice(where) {
  closeHouseRescanNotice();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="houseRescanTitle">
      <h2 id="houseRescanTitle">Scan that house again</h2>
      <p class="muted">
        <strong data-house-where></strong> stands in a house rather than in a bag, so this
        site cannot count it: the number here is still the one your last scan found.
      </p>
      <p class="muted">
        Walk into that house and run <strong>/ishare scan</strong>, then save and upload your
        saved variables file. That upload is what puts the new count on the site - until it
        arrives, copies that are already gone are still being offered.
      </p>
      <div class="modal-actions">
        <button class="primary-button" type="button" data-close-house-rescan>Got it</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  houseRescanNotice = backdrop;
  document.addEventListener('keydown', onHouseRescanKey);

  // Written as text after the dialog is on the page: the name comes from a saved-variables
  // file, so it is data, not markup.
  const named = backdrop.querySelector('[data-house-where]');

  if (named) {
    named.textContent = String(where || '');
  }

  backdrop.addEventListener('click', (event) => {
    if (
      event.target === backdrop ||
      (event.target.closest && event.target.closest('[data-close-house-rescan]'))
    ) {
      closeHouseRescanNotice();
    }
  });

  const button = backdrop.querySelector('[data-close-house-rescan]');

  if (button) {
    button.focus();
  }
}

/**
 * Says it once per session. The session is the tab's: a second placed answer in the same
 * tab is the same person already told, while a new tab is somebody starting again.
 * Storage that refuses to be written - a private window - still gets the notice, because
 * being told twice is better than never being told at all.
 */
function noteHouseRescan(where) {
  if (!where) {
    return;
  }

  try {
    if (window.sessionStorage.getItem(HOUSE_RESCAN_KEY) === '1') {
      return;
    }

    window.sessionStorage.setItem(HOUSE_RESCAN_KEY, '1');
  } catch (error) {
    // Nothing to remember it with, so say it and move on.
  }

  showHouseRescanNotice(where);
}

// ------------------------------------------------------------ leaving the page
// The browser's own beforeunload dialog cannot be styled, so the prompt here is a
// real one and beforeunload is only the last resort for a closed tab or a form post.
let leavePrompt = null;
// Set once the styled prompt has been answered with "Leave anyway", so the browser's own
// unstyled dialog does not ask the same question a second time during that navigation.
let leaveConfirmed = false;
let internalNavigation = false;

// Choosing an account posts the form from script, which does not fire a submit event, so
// both things happen here: the navigation is marked as internal - the switch keeps the
// same server-side bag - and the form is sent, taking the page back scoped to the account
// that was picked.
document.addEventListener('change', (event) => {
  if (
    !event.target.matches?.('[data-browsing-account]') ||
    event.target.form?.getAttribute('action') !== '/browsing-account'
  ) {
    return;
  }

  internalNavigation = true;

  const picked = event.target.closest?.('[data-browsing-account]');

  if (picked && picked.form) {
    picked.form.submit();
  }
}, true);

document.addEventListener('submit', (event) => {
  const action = event.target.getAttribute('action');

  // Looking at the site as somebody else keeps the basket too: it is held against the
  // person, and the person is coming back. Switching to it should not raise a question
  // about leaving.
  if (action === '/browsing-account' || action === '/view-as') {
    internalNavigation = true;
  }
}, true);

// A <details> only closes from its own summary, so the picker's menu is closed by a click
// anywhere else - the way the filter menus above the list behave.
document.addEventListener('click', (event) => {
  const open = document.querySelector('details[data-browsing-menu][open]');

  if (open && !open.contains(event.target)) {
    open.open = false;
  }
});

function closeLeavePrompt() {
  if (leavePrompt) {
    leavePrompt.remove();
    leavePrompt = null;
  }

  document.removeEventListener('keydown', onLeavePromptKey);
}

function onLeavePromptKey(event) {
  if (event.key === 'Escape') {
    closeLeavePrompt();
  }
}

function openLeavePrompt(href) {
  const held = basketHeldItems();

  closeLeavePrompt();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="leaveTitle">
      <h2 id="leaveTitle">You have unsubmitted item requests</h2>
      <p class="muted" data-leave-sentence></p>
      <p class="muted" data-leave-detail></p>
      <div class="leave-actions">
        <button class="filter-clear" type="button" data-stay>Stay on this page</button>
        <button class="primary-button" type="button" data-leave-anyway>Leave anyway</button>
      </div>
    </div>`;

  // Written as text rather than markup: it is a count, but the habit is worth keeping.
  backdrop.querySelector('[data-leave-sentence]').textContent =
    held === 1 ? '1 item is waiting to be sent.' : `${held} items are waiting to be sent.`;

  // The basket lives on the site, not in this tab, so leaving does not throw it away:
  // saying it did would be the lie the old wording told, and the person comes back to
  // the same basket and the same clock.
  const detail = backdrop.querySelector('[data-leave-detail]');

  if (detail) {
    detail.textContent =
      held === 1
        ? 'It is held on the site, not in this tab, so it will still be here when you come back. If you never send it, the item goes back to being available to everyone else when the clock runs out.'
        : 'They are held on the site, not in this tab, so they will still be here when you come back. If you never send them, the items go back to being available to everyone else when the clock runs out.';
  }

  document.body.appendChild(backdrop);
  leavePrompt = backdrop;
  document.addEventListener('keydown', onLeavePromptKey);

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || (event.target.closest && event.target.closest('[data-stay]'))) {
      closeLeavePrompt();
      return;
    }

    if (event.target.closest && event.target.closest('[data-leave-anyway]')) {
      closeLeavePrompt();
      leaveConfirmed = true;
      window.location.assign(href);
    }
  });

  const stay = backdrop.querySelector('[data-stay]');

  if (stay) {
    stay.focus();
  }
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  if (basketHeldItems() === 0) {
    return;
  }

  const link = event.target.closest ? event.target.closest('a[href]') : null;

  if (!link || link.target === '_blank' || link.hasAttribute('download')) {
    return;
  }

  const href = link.getAttribute('href') || '';

  if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
    return;
  }

  // Only another site is worth a warning. A basket is held on the server, so walking from
  // one page of this site to another keeps it, and warning about it there was a question
  // with nothing behind it - the same basket was waiting on the way back.
  if (!leavesThisSite(link)) {
    internalNavigation = true;
    return;
  }

  event.preventDefault();
  openLeavePrompt(href);
});

function leavesThisSite(link) {
  try {
    return new URL(link.href, window.location.href).origin !== window.location.origin;
  } catch (error) {
    return false;
  }
}

window.addEventListener('beforeunload', (event) => {
  if (internalNavigation) {
    internalNavigation = false;
    return undefined;
  }
  // Already answered above: the browser's own dialog would be the same warning twice,
  // unstyled and out of place.
  if (leaveConfirmed || basketHeldItems() === 0) {
    return undefined;
  }

  event.preventDefault();
  event.returnValue = 'You have unsubmitted item requests.';
  return event.returnValue;
});

// ------------------------------------------------------------------ row motion
// Removing a row is a layout change for every row under it, and that jump is what
// makes a filtered or refreshed list feel like it resized. Every removal and every
// refresh measures where the rows were, changes the DOM, then plays the difference
// back as a short slide from the old position to the new one; rows that are new
// fade in. Filters use the same machinery, and a panel's height is animated too, so
// the page below the table does not jump either. Nothing runs when the reader has
// asked for less motion.
const ROW_SLIDE_MS = 340;
const ROW_FADE_MS = 200;

function prefersReducedMotion() {
  return Boolean(
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function motionRowKey(row) {
  if (row.dataset.itemKey) {
    return row.dataset.itemKey;
  }

  return row.dataset.requestId ? `request:${row.dataset.requestId}` : '';
}

function captureRowTops(root) {
  const tops = new Map();

  root.querySelectorAll('tr').forEach((row) => {
    const key = motionRowKey(row);

    if (key) {
      tops.set(key, row.getBoundingClientRect().top);
    }
  });

  return tops;
}

/** Slides rows from where they were to where they now are; fades rows that are new. */
function animateRowsInto(root, tops) {
  if (!tops || tops.size === 0 || prefersReducedMotion()) {
    return;
  }

  root.querySelectorAll('tr').forEach((row) => {
    const key = motionRowKey(row);

    if (!key || typeof row.animate !== 'function') {
      return;
    }

    const before = tops.get(key);

    if (before === undefined) {
      row.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: ROW_FADE_MS,
        easing: 'ease-out',
      });
      return;
    }

    const delta = before - row.getBoundingClientRect().top;

    if (Math.abs(delta) < 1) {
      return;
    }

    row.animate(
      [
        { transform: `translateY(${delta}px)`, opacity: 0.65 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: ROW_SLIDE_MS, easing: 'cubic-bezier(.22,.8,.24,1)' }
    );
  });
}

/** Takes a row out and lets the rows under it slide up into the gap. */
function removeRowWithSlide(row) {
  const table = row.closest('table');
  const tops = table ? captureRowTops(table) : null;

  row.remove();

  if (table) {
    animateRowsInto(table, tops);
  }
}

/** Animates a panel's height so a table that grows or shrinks does not jump. */
function animatePanelHeights(root, heights) {
  if (!heights || prefersReducedMotion()) {
    return;
  }

  Array.from(root.querySelectorAll('[data-panel]')).forEach((panel, index) => {
    const before = heights[index];

    if (!before || panel.hidden || typeof panel.animate !== 'function') {
      return;
    }

    const after = panel.getBoundingClientRect().height;

    if (Math.abs(after - before) < 2) {
      return;
    }

    panel.style.overflow = 'hidden';

    const animation = panel.animate(
      [{ height: `${before}px` }, { height: `${after}px` }],
      { duration: ROW_SLIDE_MS + 60, easing: 'cubic-bezier(.22,.8,.24,1)' }
    );

    animation.addEventListener('finish', () => {
      panel.style.overflow = '';
    });
  });
}

// ------------------------------------------------------- relative times
// The Added column reads as a countdown - "6d 4h 18m 44s" - because a list of shared items
// is read for what is new. The server puts each moment in a `time[data-since]` and prints
// the same moment as UTC inside it; this rewrites that text in the reader's own clock.
//
// Units are counted the way a person counts: years and months first, anchored on the
// original date so a month-end does not skip a month, then days, hours, minutes, seconds.
// The count begins at the largest unit that holds anything and then writes every unit to its
// right, zeroes and all: "02s", "01m 00s", "04d 00h 00m 00s", "01mo 00d 00h 00m 00s".
// A zero therefore only appears where a bigger unit has already been written - "00d" means a
// month or more, "00h" means a day or more - so a young row is never padded out with units it
// has not reached. Once a unit is written, nothing to its right is dropped for being zero,
// which is what keeps the cell from losing a field and gaining it back a second later as the
// count rolls over. Every unit keeps two digits, so a column right-aligns and the older rows
// never shift sideways as a count goes from one digit to two. One timer drives every cell on
// the page, and a cell whose text has not changed is not written to, so a long list costs only
// the arithmetic per tick.
const RELATIVE_TICK_MS = 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function relativeUnits(from, to) {
  // A device clock a few seconds ahead of the server would otherwise count backwards into a
  // negative month and read as "1mo 30d ...". Nothing is younger than now.
  if (to <= from) {
    return { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }

  const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const anchorFor = (years, months) => {
    const anchor = new Date(from.getTime());
    anchor.setDate(1);
    anchor.setFullYear(from.getFullYear() + years);
    anchor.setMonth(from.getMonth() + months);
    // A day-of-month that does not exist in the target month (31 February) clamps to its
    // last day rather than spilling into the next month.
    anchor.setDate(Math.min(from.getDate(), daysInMonth(anchor.getFullYear(), anchor.getMonth())));
    return anchor;
  };

  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  let anchor = anchorFor(years, months);

  // The birthday has not arrived yet this year, or the month is not over: step back until the
  // anchor is in the past, which is what keeps "1 month" from appearing a day early.
  while (anchor > to) {
    months -= 1;

    if (months < 0) {
      months += 12;
      years -= 1;
    }

    anchor = anchorFor(years, months);
  }

  let rest = Math.max(0, to - anchor);
  const days = Math.floor(rest / DAY_MS);
  rest -= days * DAY_MS;
  const hours = Math.floor(rest / HOUR_MS);
  rest -= hours * HOUR_MS;
  const minutes = Math.floor(rest / MINUTE_MS);
  rest -= minutes * MINUTE_MS;
  const seconds = Math.floor(rest / 1000);

  return { years, months, days, hours, minutes, seconds };
}

/**
 * "02s" for something just offered, "18m 04s", "04d 00h 00m 00s", "01mo 00d 00h 00m 00s"
 * for an old row, and "just now" at zero.
 *
 * The count begins at the largest unit that holds anything - two seconds starts at seconds,
 * four days starts at days - and from there every unit to its right is written, zero or not.
 * So a zero only ever appears after a bigger unit has been written: "00h" on a row is a day
 * or more old, never a young row padded out to a fixed width. Once a unit is written it is
 * never dropped for being zero, so the count does not lose a field and gain it back as it
 * rolls over.
 *
 * Each unit is two digits wide for the same reason a clock is: the countdown is read as a
 * column, and "1m" growing to "10m" must not push the rest of the row along with it.
 */
function relativeText(from, to) {
  const units = relativeUnits(from, to);
  const pad = (value) => String(value).padStart(2, '0');

  // Biggest first, which is also the order they are read in.
  const fields = [
    ['y', units.years],
    ['mo', units.months],
    ['d', units.days],
    ['h', units.hours],
    ['m', units.minutes],
    ['s', units.seconds],
  ];

  // The field the count starts at: the first one holding anything. Nothing at all is a moment
  // that has only just been stamped, and it reads as words rather than as a row of zeroes.
  const start = fields.findIndex(([, value]) => value > 0);

  if (start === -1) {
    return 'just now';
  }

  return fields
    .slice(start)
    .map(([unit, value]) => `${pad(value)}${unit}`)
    .join(' ');
}

/** Rewrites every countdown under `root`, and puts the exact local time in its tooltip. */
function relativeTick(root, to = new Date()) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return;
  }

  root.querySelectorAll('time[data-since]').forEach((element) => {
    const iso = element.getAttribute('datetime');
    const from = iso ? new Date(iso) : null;

    if (!from || Number.isNaN(from.getTime())) {
      return;
    }

    const text = relativeText(from, to);

    if (element.textContent !== text) {
      element.textContent = text;
    }

    const title = `First shared ${from.toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })}`;

    if (element.title !== title) {
      element.title = title;
    }
  });
}
// ------------------------------------------------------- end relative times

/** Request times arrive as UTC ISO stamps and are shown in the reader's clock. */
function localiseTimeLabels(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return;
  }

  root.querySelectorAll('time[data-local-time]').forEach((element) => {
    const iso = element.getAttribute('datetime');
    const date = iso ? new Date(iso) : null;

    if (!date || Number.isNaN(date.getTime())) {
      return;
    }

    const text = date.toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    if (element.textContent !== text) element.textContent = text;
    // A note the server wrote about the moment (how many asks stand behind the row) is
    // carried in an attribute so rewriting the title does not throw it away.
    const note = element.getAttribute('data-local-note');
    const title = `Kept in UTC as ${iso.replace('T', ' ').replace('Z', '').trim()} UTC${
      note ? ` - ${note}` : ''
    }`;
    if (element.title !== title) element.title = title;
  });
}

localiseTimeLabels(document);
relativeTick(document);
// One timer for the whole page: every countdown on it is rewritten together.
window.setInterval(() => relativeTick(document), RELATIVE_TICK_MS);

// ------------------------------------------------------- removed basket rows
// Taking something out of the basket leaves the row where it was, marked cancelled,
// for five seconds, so the removal is visible instead of the row just vanishing.
// Then it fades and the rows under it close the gap on their own, because they are
// table rows rather than absolutely placed boxes.
//
// Only basket rows do this. A sent request stays in the history for good - that list
// is the record of what was asked for, newest first.
const CLOSED_ROW_LINGER_MS = 5000;
// Long enough to read as a fade rather than a blink: the row dims and then goes.
const CLOSED_ROW_FADE_MS = 1200;
const REMOVED_ROW_KEY = 'guildsbounty.dismissed-requests';

// Dismissals outlive a reload. Otherwise a refresh rebuilds the table, the request
// this browser has already seen out comes back, and its few seconds start again.
const removedRequestRows = new Set(readDismissedRows());
// The deadline belongs to the request, not to the element: a live refresh replaces
// the row while the clock is still running, and the new element has to inherit the
// same deadline rather than start a new one (or be skipped because the old element
// already had its timer).
const closingRequestRows = new Map();

function readDismissedRows() {
  try {
    const raw = window.sessionStorage.getItem(REMOVED_ROW_KEY);
    const stored = raw ? JSON.parse(raw) : [];

    // Ids are compared against `data-` attributes, which are strings whatever the
    // stored JSON happens to say.
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch (error) {
    return [];
  }
}

function rememberDismissedRow(id) {
  removedRequestRows.add(id);

  try {
    window.sessionStorage.setItem(REMOVED_ROW_KEY, JSON.stringify([...removedRequestRows]));
  } catch (error) {
    // Storage can be full or blocked; the dismissal still holds for this page.
  }
}

function sweepClosedRequestRows() {
  const region = document.getElementById('itemLists');

  if (!region) {
    return;
  }

  const now = Date.now();

  region.querySelectorAll('[data-basket-row]').forEach((row) => {
    const status = row.dataset.status;
    const id = row.dataset.requestId;

    if (!id || status === 'draft') {
      return;
    }

    // A live refresh rebuilds this table from the database, so a row this browser has
    // already seen out must not come back and sit here again.
    if (removedRequestRows.has(id)) {
      if (row.classList.contains('row-fading')) return;
      removeRowWithSlide(row);
      return;
    }

    let deadline = closingRequestRows.get(id);

    if (!deadline) {
      deadline = now + CLOSED_ROW_LINGER_MS;
      closingRequestRows.set(id, deadline);
    }

    if (now < deadline || row.classList.contains('row-fading')) {
      return;
    }

    closingRequestRows.delete(id);
    rememberDismissedRow(id);
    row.classList.add('row-fading');
    window.setTimeout(() => removeRowWithSlide(row), CLOSED_ROW_FADE_MS);
  });
}

const rowRegion = document.getElementById('itemLists');

if (rowRegion) {
  // The table is replaced wholesale on a live update, so new rows are picked up from
  // the mutation instead of from one pass at load.
  new MutationObserver(() => {
    sweepClosedRequestRows();
    sweepExhaustedRows();
  }).observe(rowRegion, {
    childList: true,
    subtree: true,
  });

  sweepClosedRequestRows();

  // Timers armed against an element are lost when a live update replaces it, so the
  // row is checked on a short tick instead: the deadline lives under the request id
  // and whichever element is on screen when it passes gets faded and dropped.
  window.setInterval(sweepClosedRequestRows, 500);
}

// ------------------------------------------------------------ rows that ran out
// A row whose every copy was asked for and sent has nothing left to offer. It stays
// just long enough to be seen going, then fades and the rows under it close up. The
// server keeps sending it for the same few seconds and then stops (EXHAUSTED_ROW_
// LINGER_MS in lib/store.js), so a refresh cannot bring it back.
const exhaustedRowKeys = new Set();
const exhaustedRowElements = new WeakSet();

function sweepExhaustedRows() {
  const region = document.getElementById('itemLists');

  if (!region) {
    return;
  }

  region.querySelectorAll('[data-exhausted]').forEach((row) => {
    const key = row.dataset.itemKey || '';

    if (!key) {
      return;
    }

    if (exhaustedRowElements.has(row)) return;
    exhaustedRowElements.add(row);

    // A refresh in the last seconds of the fade rebuilds the row; the one this page
    // has already seen out must not come back for another turn.
    if (exhaustedRowKeys.has(key)) {
      removeRowWithSlide(row);
      return;
    }

    exhaustedRowKeys.add(key);
    const wait = Math.max(0, Number(row.dataset.exhausted) || 5000);

    window.setTimeout(() => {
      if (!row.isConnected) {
        return;
      }

      row.classList.add('row-fading');
      window.setTimeout(() => removeRowWithSlide(row), CLOSED_ROW_FADE_MS);
    }, wait);
  });
}

if (rowRegion) {
  sweepExhaustedRows();
}

// ------------------------------------------------------------- ESO accounts
// Which accounts are linked is reference material: it lives behind the profile menu,
// in the modal the page already rendered, rather than above the item list.
const accountsModal = document.getElementById('accountsModal');

function closeAccountsModal() {
  if (!accountsModal || accountsModal.hidden) {
    return;
  }

  accountsModal.hidden = true;

  const opener = document.querySelector('[data-open-accounts]');

  if (opener) {
    opener.focus();
  }
}

function openAccountsModal() {
  if (!accountsModal) {
    return;
  }

  accountsModal.hidden = false;

  // The account name box is the reason the dialog opened, so it takes the caret. On a
  // visit that only looks at what is attached, the close button does.
  const field = accountsModal.querySelector('input[name="accountName"]');
  const close = accountsModal.querySelector('[data-close-accounts]');

  if (field) {
    field.focus();
  } else if (close) {
    close.focus();
  }
}

// Somebody who has signed in and attached no ESO account lands with the dialog already
// open: attaching one is what turns the shared list into a list they can ask from. It is
// drawn open without a script, so this only puts the caret where the work is.
if (accountsModal && accountsModal.hasAttribute('data-accounts-auto') && !accountsModal.hidden) {
  openAccountsModal();
}

document.addEventListener('click', (event) => {
  const closest = event.target.closest ? event.target.closest.bind(event.target) : () => null;

  if (!accountsModal) {
    return;
  }

  if (closest('[data-open-accounts]')) {
    event.preventDefault();
    openAccountsModal();
    return;
  }

  if (closest('[data-close-accounts]')) {
    event.preventDefault();
    closeAccountsModal();
    return;
  }

  // The backdrop is the modal's own parent, so a click on it is a click outside.
  if (!accountsModal.hidden && event.target === accountsModal) {
    closeAccountsModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && accountsModal && !accountsModal.hidden) {
    closeAccountsModal();
  }
});

// Escape puts an open filter menu away, the way a click outside it does: the summary opens the
// box from the keyboard, so the keyboard should be able to shut it too. Kept as a plain
// function taking its own root, so the key can be tried on its own - see test:filter-rows.
function escapeClosesFilterMenu(event, root = document) {
  if (!event || event.key !== 'Escape') {
    return false;
  }

  const open = root.querySelector('[data-filters] details[open]');

  if (!open) {
    return false;
  }

  open.open = false;

  return true;
}

document.addEventListener('keydown', (event) => {
  escapeClosesFilterMenu(event);
});

// -------------------------------------------------------------- item tooltips
// A name says what the item is without leaving the page. The card starts with what
// the row already knows (name, type, trait, level), then /item-tip adds the game's
// description and what the item's set does - fetched from UESP once and cached
// server-side, so hovering the same name again costs nothing.
const tipCard = document.createElement('div');
tipCard.className = 'item-tip-card';
tipCard.hidden = true;
document.body.appendChild(tipCard);

const tipCache = new Map();
let tipTrigger = null;
let tipTicket = 0;
let tipPoint = { x: 0, y: 0 };

function tipElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }

  return element;
}

// Beside the pointer, never under it: the name being read stays visible, and the
// card flips to the other side near an edge rather than hanging off the window.
function placeTipCard() {
  if (tipCard.hidden) {
    return;
  }

  const width = tipCard.offsetWidth;
  const height = tipCard.offsetHeight;
  const gap = 22;
  let left = tipPoint.x + gap;
  let top = tipPoint.y + 18;

  if (left + width > window.innerWidth - 12) {
    left = tipPoint.x - width - gap;
  }
  if (left < 12) {
    left = 12;
  }
  if (top + height > window.innerHeight - 12) {
    top = Math.max(12, tipPoint.y - height - 18);
  }

  tipCard.style.left = `${Math.round(left)}px`;
  tipCard.style.top = `${Math.round(top)}px`;
}

// ESO item text carries the game's own colour codes: |cRRGGBB switches colour and
// |r returns to it, and |H...|h wraps a link nobody can follow from a card. They are
// read here, after escaping, so a number arrives as a coloured number rather than
// as "|cffffff10|r". Codes too dark for the card's panel are lifted towards white.
function esoColour(hex) {
  const value = parseInt(hex, 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const luminance =
    (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255;

  if (luminance >= 0.3) {
    return `#${hex}`;
  }

  return `#${channels
    .map((channel) =>
      Math.round(channel + (255 - channel) * 0.7)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

function esoMarkup(text) {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  let open = 0;

  const coloured = escaped.replace(/\|c([0-9a-fA-F]{6})/g, (match, hex) => {
    open += 1;
    return `<span style="color:${esoColour(hex)}">`;
  });

  const closed = coloured.replace(/\|r/g, () => {
    if (open <= 0) {
      return '';
    }

    open -= 1;
    return '</span>';
  });

  return (
    closed
      // |H1:item:123|hLabel|h: keep the label and drop the link around it.
      .replace(/\|H[^|]*\|h/g, '')
      .replace(/\|h/g, '')
      // Whatever else starts with a pipe is a code the game understands, not text.
      .replace(/\|[A-Za-z]/g, '') + '</span>'.repeat(Math.max(0, open))
  );
}

function tipText(tag, className, value) {
  const element = tipElement(tag, className);
  element.innerHTML = esoMarkup(value);
  return element;
}

function renderTipCard(trigger, detail) {
  tipCard.textContent = '';

  const head = tipElement('div', 'item-tip-head');
  const name = tipElement('strong', 'item-tip-name', trigger.dataset.tipName || 'Item');

  name.style.color = trigger.dataset.tipColor || '';
  head.appendChild(name);

  if (detail && detail.unique) {
    head.appendChild(tipElement('span', 'item-tip-tag', 'Unique'));
  }

  tipCard.appendChild(head);

  const meta = trigger.dataset.tipMeta || '';

  if (meta) {
    tipCard.appendChild(tipElement('div', 'item-tip-meta', meta));
  }
  if (detail && detail.description) {
    tipCard.appendChild(tipText('p', 'item-tip-text', detail.description));
  }
  if (detail && detail.traitDesc) {
    tipCard.appendChild(tipText('p', 'item-tip-text', detail.traitDesc));
  }

  if (detail && detail.set && detail.set.name) {
    const block = tipElement('div', 'item-tip-set');

    block.appendChild(tipElement('div', 'item-tip-set-name', detail.set.name));

    if (Array.isArray(detail.set.bonuses) && detail.set.bonuses.length > 0) {
      const list = document.createElement('ul');

      detail.set.bonuses.forEach((bonus) => list.appendChild(tipText('li', '', bonus)));
      block.appendChild(list);
    }

    tipCard.appendChild(block);
  }

  if (detail && detail.fromUesp) {
    tipCard.appendChild(tipElement('span', 'item-tip-source', 'Details from UESP'));
  }

  tipCard.hidden = false;
  placeTipCard();
}

async function fillTipCard(trigger) {
  const item = Number(trigger.dataset.tipItem) || 0;
  const set = trigger.dataset.tipSet || '';

  if (item <= 0 && !set) {
    return;
  }

  const key = `${item}|${set.toLowerCase()}`;
  const ticket = tipTicket;

  if (tipCache.has(key)) {
    renderTipCard(trigger, tipCache.get(key));
    return;
  }

  const params = new URLSearchParams();

  if (item > 0) {
    params.set('item', String(item));
  }
  if (set) {
    params.set('set', set);
  }

  try {
    const response = await fetch(`/item-tip?${params.toString()}`, {
      credentials: 'same-origin',
    });

    if (!response.ok) {
      return;
    }

    const detail = await response.json();

    if (!detail || detail.available === false) {
      return;
    }

    tipCache.set(key, detail);

    // Only write it into the card if the pointer is still on this name and this is
    // still the newest lookup; a fast reader must not get a slow answer for the
    // row above.
    if (tipTrigger === trigger && ticket === tipTicket) {
      renderTipCard(trigger, detail);
    }
  } catch (error) {
    // The card keeps the details the page already carries.
  }
}

function showTipCard(trigger, point) {
  tipTrigger = trigger;
  tipTicket += 1;
  tipPoint = point;
  renderTipCard(trigger, null);
  fillTipCard(trigger);
}

function hideTipCard() {
  tipTrigger = null;
  tipTicket += 1;
  tipCard.hidden = true;
}

document.addEventListener('mouseover', (event) => {
  const trigger = event.target.closest ? event.target.closest('[data-item-tip]') : null;

  if (!trigger) {
    hideTipCard();
    return;
  }

  if (trigger !== tipTrigger) {
    showTipCard(trigger, { x: event.clientX, y: event.clientY });
  }
});

document.addEventListener('mousemove', (event) => {
  if (tipCard.hidden) {
    return;
  }

  tipPoint = { x: event.clientX, y: event.clientY };
  placeTipCard();
});

document.addEventListener('mouseout', (event) => {
  const trigger = event.target.closest ? event.target.closest('[data-item-tip]') : null;

  if (trigger && !trigger.contains(event.relatedTarget)) {
    hideTipCard();
  }
});

// Keyboard readers get the same card: tabbing onto a name opens it, tabbing on
// closes it, and it is anchored to the name rather than to a pointer that is not
// there.
document.addEventListener('focusin', (event) => {
  const trigger = event.target.closest ? event.target.closest('[data-item-tip]') : null;

  if (!trigger) {
    return;
  }

  const rect = trigger.getBoundingClientRect();
  showTipCard(trigger, { x: rect.right, y: rect.top });
});

document.addEventListener('focusout', (event) => {
  if (event.target.closest && event.target.closest('[data-item-tip]')) {
    hideTipCard();
  }
});

window.addEventListener('scroll', hideTipCard, { passive: true });
window.addEventListener('resize', hideTipCard);
