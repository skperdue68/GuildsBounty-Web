from pathlib import Path

path = Path("testFilterRows.js")
text = path.read_text()

old = """console.log(`\\\\n${total - failures}/${total} checks passed`);"""

if text.count(old) != 1:
    raise SystemExit(f"anchor: expected 1, found {text.count(old)}")

new = """// ------------------------------------------------------------------ the numbers on the row

// The count beside a type exists twice - on the category heading and in the menu - and the
// two have to be the same number. The heading is drawn from the rows; the menu's is rewritten
// from the same rows, so a push that adds or drops rows cannot leave one of them behind.

t('the menu's count is a span of its own, so the number can move without the name', () => {
  const bar = filterBar(facets, {}, { list: 'request' });

  assert.match(bar, /<span data-filter-label>Weapons<\\/span>/, 'the name on its own');
  assert.match(bar, /<span class="filter-option-count">\\(2\\)<\\/span>/, 'and the count beside it');
  assert.doesNotMatch(bar, />Weapons \\(2\\)</, 'the two are never fused into one label');
});

t('every row says its type and its list, so the menu can count its own', () => {
  const region = renderListRegion({
    user: { provider: 'discord', username: 'evainefaye', id: 1, accountNames: ['@Eva'] },
    accounts: [{ accountName: '@Eva', guilds: [{ guild_name: 'G' }], platform: 'pc', worldName: 'NA' }],
    browsingAccount: '@Eva',
    sharedItems: [],
    requestItems: [
      {
        id: 1,
        item_key_hash: 'a1',
        item_name: 'Briarheart Dagger',
        item_type_name: 'Weapons',
        item_count: 2,
        location_label: 'Bank',
        account_name: '@Other',
      },
      {
        id: 2,
        item_key_hash: 'a2',
        item_name: 'Ancient Silk Robe',
        item_type_name: 'Apparel',
        item_count: 1,
        location_label: 'Bank',
        account_name: '@Eva',
      },
    ],
    requestOffers: [],
    alwaysShare: [],
    facets,
    facetsMine: { types: [], owners: [] },
    filters: {},
    requests: [],
  });

  assert.match(region, /<table class="list-table" data-list="request"/, 'the request table names its list');
  assert.match(region, /data-type-name="Weapons"/, 'and its rows name their type');
  assert.match(region, /<table class="list-table" data-list="offer"/, 'so does the own-bag table');
});

t('the counts are read back off the page, not from what it was first sent', () => {
  const app = read('public/app.js');

  assert.match(app, /function syncTypeCounts\\(\\)/, 'the recount exists');
  assert.match(
    app,
    /table\\[data-list="\\$\\{list\\}"\\] tbody tr\\[data-type-name\\]/,
    'it counts the rows of its own list'
  );
  assert.match(app, /count\\.textContent = `\\(\\$\\{total\\}\\)`/, 'and writes the number beside the type');
  assert.match(app, /option\\.hidden = total === 0/, 'a type with no rows stops being a choice');
  assert.match(app, /function drawFilterCard\\(card, content\\)/, 'the card is drawn again on a push');
  assert.match(
    app,
    /syncTypeCounts\\(\\);\\n    syncFilterCard\\(\\);/,
    'and every applied page is recounted before the card is decided'
  );
});

t('a folded type keeps its rows, so folding cannot move a count', () => {
  const app = read('public/app.js');
  const recount = app.slice(app.indexOf('function syncTypeCounts()'));

  assert.doesNotMatch(
    recount.slice(0, 2400),
    /if \\(row\\.hidden\\) continue/,
    'a row hidden by a fold still counts'
  );
});

console.log(`\\\\n${total - failures}/${total} checks passed`);"""

text = text.replace(old, new)
path.write_text(text)
print("patched testFilterRows.js")
