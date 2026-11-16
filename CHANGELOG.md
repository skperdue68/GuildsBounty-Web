# Changelog

What changed for the people using the site, newest first. Dates are the day a change
landed on `main`.

## Unreleased

### Changed

- **The standing-offers heading is a heading again, not a bar as deep as the whole pinned
  strip.** It was given the height of the tabs, the filter band and the search row together so
  that it could cover the tabs while a long list scrolled under it - which left roughly 90px of
  empty colour above the words *and* 90px below them, in the middle of the list, on every page
  that has standing offers. It is now as tall as the tab row it replaces: 52px here instead of
  202px, measured in a stand-in page with the real stylesheet, with the words 18px from either
  edge. The gaps around it shrink with it.

- **A filter can no longer empty its own menu.** The type menu was recounted from the rows on
  the page, and a filtered list only holds the chosen slice - so choosing *Apparel* said every
  other type had nothing in it and took them out of the box, leaving one choice and no way
  back. The menus are the list's, not the slice's: the server already draws them from every
  row it has for that list, whatever the filters are, so the page now leaves their options
  alone and only moves the numbers. That holds for both rows - *Type* and *Offered by* - and
  for each list separately.

- **The filter row sits inside the list card, between the tabs and the search.** It was a card of
  its own above the list, which left a box nobody looked at and a band of empty space under it.
  It is now the list's own band: air above and below, the three menus centred, RESET lined up
  with the bottom of the dropdowns, and the chips taking room only when there are any, so the
  empty row shrinks away instead of holding a line open. The band pins with the tab strip above
  it and the search row below it, so the whole strip - tabs, filters, applied chips, search -
  stays in place while a long list scrolls under it, and the column headings clear all three.

- **Every number that counts rows follows the rows on the page.** The tab's count and the number
  beside each type are read back from the rows themselves after a search as well as after a
  push: type "dagger" and Browse Offers counts the rows that are left rather than the list's
  total, and a type with nothing left counts (0) until the server draws the list again. Folding
  a type still counts its
  rows - a folded row is one the list holds - so the numbers only move when the rows do.

- **An upload writes down every item it added or removed.** The count under the file drop says
  how many rows moved, but not which ones - so the log now gets a line per item, with its name,
  the place it sat (*Bank*, *Housing Storage (MISC)*) and the character whose scan it was filed
  under. A row that goes while the same item is still in the file says who it is filed under
  now, which is what turns "230 items removed" into an answer. An upload that changed nothing
  says so, and `journalctl -u <service> | grep '@account'` is then one account's whole history.

- **The demo database is granted to the site's own account as it is made.** MariaDB grants per
  database name, so an account holding `guildsbounty.*` could create `guildsbounty-demo` and
  then be refused every table in it, and the demo reported itself not ready until somebody ran
  a second `GRANT` by hand. A database the site creates now comes with the privileges the
  account that created it needs on that one database (SELECT, INSERT, UPDATE, DELETE, CREATE,
  DROP, ALTER, INDEX, REFERENCES, LOCK TABLES), and the boot log confirms it. `GRANT` needs
  `GRANT OPTION`, which an application account normally does not have; where it is refused,
  the log prints the statement to run as an administrator instead of failing.

- **The site has one name, everywhere.** The package, the cookies that remember sorting,
  grouping and folded types (`guildsbounty_sort`, `guildsbounty_group`, `guildsbounty_collapsed`
  and the rest, one per list), the keys the browser keeps to itself, the `X-GuildsBounty-*`
  headers, the mail boundary and `Message-ID` domain, the fallback session-secret prefix, the
  tables, the database, the wordmark, the uploaded file the instructions ask for
  (`GuildsBountySavedVars.lua`), the addon files those instructions name (`GuildsBounty.lua`,
  `GuildsBountyExport.lua`), the in-game `/guildsbounty` command and the demo account
  (`@GuildsBountyDemo`) all read **GuildsBounty** now. The database is `guildsbounty` (and
  `guildsbounty-demo` for the demo, whose anonymised addresses are `@guildsbounty.invalid`), its
  bookkeeping table is `guildsbounty_schema_migrations`, and the setting is
  `GUILDSBOUNTY_DATABASE`; the migration files were renamed to `NNN_guildsbounty_*.sql` to match.
  The notice for an old address reads *Guild's Bounty answers here now*, and no address counts
  as an old one until it is listed in `LEGACY_HOSTS`.

  Nothing is read or accepted under the old name any more: a request with the old headers, a
  file whose table is called anything but `GuildsBountySavedVars`, or a database on the old
  table names is simply not this site's. The addon has to agree with the site on the table name
  it writes.

  Two consequences worth knowing before it is deployed: rebranding the cookies means one visit
  starts from the defaults again, and the database has to exist as `guildsbounty` with
  `guildsbounty_*` tables before the first boot, because the site no longer moves anything into
  place for you.

- **The filter card belongs to Browse Offers and My Inventory, and the two now keep their own
  filters.** It used to sit above every tab and narrow one shared idea of the list, so a type
  chosen on what the guild shares also hid rows inside your own bag, and carrying the card
  onto My Requests and Requests Received offered filters that had nothing to say about those
  tables. Each of the two item lists now has its own row, its own three names in the address
  bar (`type`/`owner`/`added` for Browse Offers, `mtype`/`mowner`/`madded` for My Inventory)
  and its own menus, built from its own rows. Switching tabs shows the filters that tab was
  left with, RESET clears just that row, and the card is gone entirely from My Requests and
  Requests Received.

- **The two tabs that explain their sorting no longer do.** My Requests and Requests Received
  both carried a paragraph under their last table about pressing a heading once, twice, three
  times, and about the small number beside an active heading - a lot of words to read every
  visit to be told what a press does. The headings still sort, still reverse, still stop, and
  still number their place in the order; the sentences explaining it are gone. The **Waiting on
  your items** table also drops its own line, *Nothing is recorded until you press Fulfilled on
  that row*: the button says it.

- **A request email now takes you straight to the table you came to answer.** Following the
  link signs you in and opens Requests Received as before, and now also jumps the page to
  **Waiting on your items**, with the pinned top bar, tabs and search row allowed for, instead
  of leaving it below the fold under the tab strip.

### Fixed

- **An open filter menu is drawn over the search row, not behind it.** The menu is a child of
  the filter band, so its own layer was capped by the band's: at z-index 12 the band sat below
  the search row (13) and the bottom of a long list of types was painted behind the search box.
  The band moves to 15, above the search row, and the subhead that takes the pinned row over
  moves to 16 so it still covers both. Checked in the browser: a point inside the open menu
  that also sits over the search row reports the menu at 15 and the search row at 12.

- **A type whose last row has gone leaves the menu, and its chip with it.** The option was
  marked hidden, but `display: flex` on `.filter-option` outranked the browser's `[hidden]`
  rule, so the type stayed in the list with `(0)` beside it. The menu now restates the rule,
  and a ticked type that loses its last row is unticked and the filter row is applied again, so
  the chip under the bar goes with the option instead of leaving a filter the reader cannot see
  or switch off.

- **The page no longer stops before it has wired itself up.** The names each list's filters
  travel under were declared below the line that draws the first tab, and that line now counts
  a menu - so reading them threw `Cannot access 'FILTER_PARAMS' before initialization`, the load
  stopped halfway, both lists' filter rows stayed on screen and the type headings stopped
  opening. The names are declared with the rest of the page's state now, above anything that
  runs at load, and a tab shows its own row before it narrows or counts anything, so one failure
  there cannot leave two rows on the page.

- **Every count beside a type now comes from the rows on the page.** The number in the Type menu
  was whatever the page was first sent, so after a live push - somebody uploading, an offer
  running out - it kept counting rows that were no longer there until the page was reloaded.
  It is now read back off the rows themselves every time they change, in the same pass that
  recounts the category headings, so the menu and the headings cannot disagree; a type with no
  rows left stops being an option, and the card is drawn again on each push rather than merged
  so a new type arrives with an option to pick. Folding or searching still only hides rows, so
  neither moves a count.

- **Browse Offers only offers the types and owners it actually lists.** Its menus were built
  from every row the viewer could see, which included their own bag and bank - so the Type menu
  offered Apparel, Recipe, Weapon and the rest from My Inventory even when the guild was only
  sharing Collectibles, and choosing one could only return an empty list. The menus now leave
  out rows the viewer owns, exactly as the list does. A chosen type or owner whose last row has
  gone is dropped from the row as well: it leaves the menu, the chip under it, the count on the
  Type box and the query together, instead of narrowing the list to nothing behind a value
  nobody can see any more. The menus' scrollbar is drawn in the site's blues rather than the
  browser's grey.

- **The link in a request email now lands on the site signed in, on Requests Received.** It used
  to offer two ways in and neither worked from an inbox: the **Answer these requests** button
  opened a plain quantity-and-Save page whose Save was refused with *sign in*, because every
  signed-out write under `/requests` was turned away - and the **Already signed in? Open
  Requests Received** link only ever reached a login screen, since it required the session it
  was offering a shortcut to. The email's token already names whose ESO accounts the requests
  are aimed at, so the link now builds that person's session and redirects to
  `/?tab=received`, where the rows wait with everything else on their items. Save from the bare
  form works too, signed in or not - the token is that form's whole permission. A browser
  already signed in as somebody else is left alone and gets the bare form instead of a silent
  account switch.

- **A sort on Location no longer hides on the Request list, or numbers the first column there
  `2`.** Location is a column on My Inventory only. Sorting by it and then opening Request left
  a queue the Request headings could not show - no badge anywhere, so the list looked unsorted -
  while the rows stayed ordered by it and the first heading pressed was numbered `2` with
  nothing above it, then `3`. Each table now counts only the columns it draws, so the numbers
  and the rows agree: Location still decides on My Inventory and is simply not part of the
  Request list's order.

### Added

- **Drop the saved variables file anywhere on the site.** The drop target was one card on two
  pages, so a file dragged over any other page made the browser leave the site and show the
  .lua as text. The whole page is the target now: carrying a file over it draws an overlay
  saying where it will go, and letting go hands it to the same upload the card uses. Anything
  that is not a `.lua` or `.txt` is said plainly instead of being sent to be refused, a visitor
  is asked to sign in, and a demo account is told uploading is off - the same three answers the
  card gives, so a drop cannot behave differently from the box it duplicates.

- **Arriving by an old address says the site has a new one.** An address listed in
  `LEGACY_HOSTS` still works, and a visit by it opens a short card - *Guild's Bounty answers here
  now*, with `NEW_SITE_URL` linked - that closes itself after ten seconds or on the cross. It
  appears only on the page somebody lands on, only for the old name: a visit by the new one has
  nothing to read, and a live refresh does not bring it back. Which names count is
  `LEGACY_HOSTS`, and where it points is `NEW_SITE_URL`. The name is read from `Forwarded`
  (`host=`), then `X-Forwarded-Host`, then `X-Served-By`, then `Host`, and every response says
  the name it settled on in **`X-Site-Host`** - one `curl -I` then tells a proxy that is
  passing the name from one that is rewriting it.

- **Requests Received: a fourth tab, where the owner's list used to live behind the account
  menu.** It is the same working list the owner's page draws - one row per item, the quantity
  asked for, the amount sent filled in ready to change, and **Fulfilled** / **Not fulfilled** -
  but it is in the item list rather than a modal, so answering does not replace what you were
  reading. Under it is **Already answered**: what was handed over, how many arrived of how many
  were asked, to whom, and when. New asks reach an open page the same way every other change
  does, so the tab fills in - and its count moves - without a reload, and the tab somebody is
  reading stays open across that refresh. Answering from the tab comes back to the tab and says
  what it recorded. The account menu's **Process Requests** entry is gone, since the tab is where it
  was pointing; `/owner/requests` still works for a bookmark.

- **The Discord account named `evainefaye` can look at the site as anybody.** An extra item
  in the avatar menu lists everybody else in the system, alphabetically - your own name is not
  in it, and neither is whoever's page you are already on - and picking one, with no button to
  press after it because the choice is the action, makes the session act as them: their guilds
  and their shelf, the requests addressed to them, their name on the avatar and their pending
  count. A banner across the top of every page says whose site is on
  screen, and *Return to my own login* puts it back - picking your own name does the same.
  It is a test tool and not a role: nothing grants it, it is checked on every request rather
  than remembered, it needs Discord (a Google or email login with that name does not get it),
  both routes answer everybody else with the same 404 as a page that is not there, the list
  is only the copy the session belongs to, and the database a session reads follows the person
  who really signed in. Anything written while looking at somebody's site is written as them.
- **The header is the Guild's Bounty plaque.** The chest, the name and *Shared items across
  your guilds* are one picture file shown at 180 pixels wide, so the top bar grows to the
  artwork instead of stacking a mark, a wordmark and a line of text under them.

- **The request count on the avatar keeps itself up to date.** A new ask for one of your
  items puts the number on your avatar the moment it lands - no refresh, and not only in the
  window it arrived in. The update is addressed to your sign-in alone and carries the total
  rather than a change, so two tabs and a phone cannot end up showing different numbers, and
  a page that was asleep or offline is told the count that stands as soon as it reconnects.
  Taking a request back lowers it the same way, and a basket sent to several owners tells each
  of them their own number.
- **A count on the avatar** says how many requests are waiting to be processed: a small red
  circle with the number in white, on the top right of the avatar and half outside it. It
  counts what the requests list counts - one per item, however many people asked for it,
  because one answer settles them all - and no circle is drawn when there is nothing to
  answer. Past ninety-nine it reads **99+** rather than growing wider than the avatar. The
  number is worked out before the page is drawn, so it is there on arrival and on every
  page with a header, not only on the requests list.
- **`npm run delete:user`** removes a person by the name they sign in with, with everything
  attached to them: their ESO accounts and the items, offers, guild memberships and uploads
  on them, their baskets and requests, the guild codes they made and the redemptions of
  them, and their sign-in rows and sessions. It all happens in one transaction, and it
  counts every known reference afterwards, rolling back rather than committing a
  half-removed person. `--list` prints the email and password logins it can remove, with
  their id and how many ESO accounts each has, and `--dry-run` shows what removal would
  take. Both listing and removing work on logins made on the site with an address and a
  password, not on Discord or Google sign-ins.
- **The guild slot a code opened** is listed on its own under the guilds the game reported,
  labelled *Guild slot from a code*: it is an invitation that was accepted, not a membership
  the character has in game, and mixing the two made the list read as if the game had
  reported it.
- **LAST CHANCE.** An item an owner keeps shared for a fixed number of days is flagged once
  that window has run out. The window is the file's `expireDays` (14 in a typical file),
  measured from the day the item was first shared. The row is only flagged: it is not
  dimmed, it can still be asked for, and its counts do not change. Hovering the pill
  explains the owner's window - *Item has been shared longer than 14 days and is subject to
  being removed from sharing, act quickly!* Files without `expireDays` never show it.
- **Added → LAST CHANCE**, the last choice in the Added menu, which shows only the rows
  past their owner's window.
- **The demo shows LAST CHANCE too.** Its own account and the three demo guildmates keep
  items for 30 days, and the shelves are dated from months old down to a few hours, so a
  demo visit has both states at once: the oldest rows carry the pill and the newest do not,
  and *Added → LAST CHANCE* has rows to show.

- **The demo's gear says what it is.** Every weapon, armour piece and piece of jewellery in
  the demo catalogue now carries the level, the champion point requirement and the glyph it
  is enchanted with - `Level CP160`, *Glyph of Increase Physical Harm* and so on - instead of
  reading as a level 0 item with no enchantment. The simulator's three people share the same
  gear, so they carry it too.
- **Every shared item shows a level.** The demo and simulated catalogues give the things
  that are not gear - materials, consumables, furnishings and motifs - level 1, which is
  what an item with no requirement carries. They still have no champion points, glyph or
  style, because they have none: the row reads *Level 1* and stops there, rather than
  looking as though its level were simply unknown.
- **An upload now says what it did to your list.** The answer under the file drop gives each
  account's totals and then, underneath, `2 items removed, 5 items added, 1 item refreshed`.
  A refresh is an item you already had whose quantity the file reports differently - a stack
  that grew or shrank - so it is not mistaken for something new or something gone, and an
  item left alone because a request is still open is counted as none of the three.


### Fixed

- **A stack in the bank is one row, whoever scanned it.** A row was identified by the account,
  the character and the item, so every account-wide stack - the bank, house storage, the
  furnishing vault - became a new row each time a different character ran a scan: the old row
  was pruned and an identical one inserted, which is what made an upload report hundreds of
  items removed while the total stayed exactly right, and why the same file uploaded twice
  looked clean. Identity now follows the storage: a character's own bags belong to that
  character, everything account-wide belongs to the account, and a guild bank belongs to the
  guild - no account in its key at all, because every member looks at the same shelves. The
  first member to record a guild bank stack stays the owner of the row, so a second member's
  scan refreshes the count without taking it away from their open requests, and an upload only
  prunes the guild banks its own file names. Migration 031 re-keys the existing rows, keeping
  the newest copy of each and moving requests and guild links onto it.

- **Your own items can no longer disappear behind a guild.** The list lets you see a row
  through a guild you belong to, and separately lets you see your own rows - but that second
  branch only covered rows with *no* guild link at all. An item stamped with a guild the join
  could not match (a guild the account had left, a guild row written on another world) was
  therefore hidden from everybody, its owner included, even though the upload had stored it
  and the answer had counted it. Your own shares are now yours however they are stamped;
  other people still only see what their guilds reach.
- **The date an item was first offered is read from the item, not the row.** 1.11.39 keeps
  one date per item link in `itemFirstDumped`, beside the item list, and clears the copy it
  used to write on every share row. So one thing standing in the bank and again in a house
  reports one date, and the addon's own LAST CHANCE badge and this list finally measure the
  same day. A row whose link has no date in that table is stored as 0 rather than borrowing
  another row's.
- **A share keeps the date it was first added.** An upload that matched an item already on
  the table rewrote the whole row, the moment it arrived included, so an item handed out
  and shared again - or the same item shared from a second character on the account - took
  the later date and read as new. Everything else about the row is still refreshed: the
  count, the place it sits, the last time it was seen. Only the arrival date is held, and
  when two files disagree about it the older one wins; a row still goes when a scan no
  longer finds the item, and coming back after that is a fresh arrival. Standing offers
  keep their own first date the same way.

- **A standing offer now offers what its owner actually has, and never a guess.** *Offered*
  is the copies they hold in the place they marked, less the amount they keep back there,
  and *Available* is that less whatever a request is already standing on. A row is drawn,
  and a request button appears, only while the file says how many are held and that number
  is above the reserve: an offer whose stock is all kept back, whose copies are all spoken
  for, or whose count the file never wrote is not a row to ask from. Nothing is assumed in
  its place - a missing count used to read as one copy, which is how an emptied bag went on
  offering one - so offers appear once an upload from addon 1.11.10 or later carries the
  count and the place it was marked in. Reopening an expired request applies the same rule.

- **An item's age is counted from a real UTC instant.** The elapsed time in **Added** came
  from a timestamp MariaDB had already converted into the database host's own time zone,
  which the query then labelled `Z`; on a host six hours behind UTC an item offered a
  minute ago read as six hours old. Connections are now put in UTC and the lists ask for
  `UNIX_TIMESTAMP(first_seen_at)`, so the count starts from the moment itself and each
  reader sees it run in their own clock. Request times, LAST CHANCE and the *Added* windows
  measure from the same instant, exactly as before.

### Fixed

- **Opening a folded type on My Inventory did nothing.** Folding worked, and so did the
  caret, but the rows never came back: the heading named its list `mine`, which is the **My
  Requests** tab, and opening a type hands the rows back through that tab's panel - which
  draws no item table at all. The two lists now name themselves with their tab's own word
  (`request` for **Browse Offers**, `offer` for **My Inventory**), so opening a type finds
  the table it belongs to. The rows are also given back first and narrowed afterwards, so a
  fold opens even if the search has nothing to say about it.

### Changed

- **The avatar is just the picture.** The header used to draw the name beside the avatar, and
  then on a row under it inside a pill; either way it was the same name the menu already says
  when it opens, and it left the picture cramped. The name and the caret are gone and the
  circle is bigger - 38px, up from 30px - inside a light ring that answers to hover. The
  picture itself opens the menu. The button keeps its label - *Account menu for Develia, 3
  requests to process* - so a screen reader still hears whose menu it is and what is waiting.
- **The fold's caret is a chevron you can read.** It was a 10px text arrow beside 11px
  capitals, which read as a speck rather than an indicator; it is now a drawn chevron at
  15px, turning from right to down in 120 ms (no turn at all where reduced motion is asked
  for).
- **Two request tables are named for what they hold.** *Already sent* on **My Requests** is
  now **Submitted requests**, and *Already answered* on **Requests Received** is now
  **Completed requests**: "already sent" read as though the item had gone out, when the table
  is the requests you submitted and the status column says what became of them. Only the
  words changed - the rows, their sorting, paging and cookies are the same.
- **A type heading folds its own rows away.** A press on the heading (not only on its count)
  closes that type, and the count stays beside the name so a folded type reads as folded
  rather than empty; a caret on the row points right while the rows are away and down when
  they are back. Which types are folded is remembered per list, in `guildsbounty_collapsed` for
  **Browse Offers** and `guildsbounty_collapsed_mine` for **My Inventory**, so it survives a
  reload and the two lists fold independently. A search word does not reopen a folded type:
  its heading keeps the count of what matched, and opening it shows those rows.
- **One press folds the whole list, or opens all of it.** Beside **Grouped by type** is a
  small **Collapse all** / **Expand all** button - the word is the action, so it reads
  *Collapse all* while anything is open and *Expand all* once everything is shut, with a
  chevron that turns the same way as the per-type one. It acts on the tab it sits on, in that
  list's own cookie, so folding everything on **Browse Offers** leaves **My Inventory** as it
  was. It is drawn whenever a list is grouped, even one holding a single type - a guild that
  shares only collectibles would otherwise never see it - and only a flat list has no folds
  for it to reach.
- **The search boxes on My Requests and Requests Received filter as they are typed.** They
  were accepted and then dropped by the handler that whitelisted the older two tabs, so a word
  in either box waited for a reload; all four now narrow on the same delay as each other.
- **Grouping is per list.** **Browse Offers** and **My Inventory** each remember whether they
  are cut up by type or shown as one flat list (`guildsbounty_group` and `guildsbounty_group_mine`),
  so one can be grouped while the other is not, and the switch on each tab reports its own
  list. Turning the headings off on one no longer turns them off on the other.
- **The search boxes on My Requests and Requests Received span the card.** They sit in the
  same tools row as the other two tabs rather than in a narrow column of their own, with the
  cross at the right-hand end clearing them, and they narrow both tables on the tab as the
  word is typed.
- **Every request table says what it is, even when it is empty.** *In your basket* and
  *Already sent* on My Requests, and *Waiting on your items* and *Already answered* on
  Requests Received, keep their headings and put one line across every column when there is
  nothing in them - *No items have been requested.*, and so on - instead of disappearing. The
  line leaves as soon as a row arrives and returns once the last one has been sent, cancelled
  or has timed out. The sentence above the basket is a size up and has air under it, because
  it is the instruction on that tab rather than a caption.
- **All four of those tables sort, and each remembers its own order.** Basket, sent, waiting
  and answered each cycle a heading through ascending, descending and off, several at once,
  under their own cookie (`guildsbounty_basket_sort`, `guildsbounty_sent_sort`,
  `guildsbounty_owner_sort`, `guildsbounty_answered_sort`), so an order read in the basket says
  nothing about the log.
- **My Requests and Requests Received have a search box.** *Search this list* narrows both
  tables on the tab at once, and each tab keeps its own word.
- **A request email can open the tab.** The message still leads with the link that answers
  without signing in, and now also offers *Open Requests Received* (`/?tab=received`); the
  list opens any tab named in a link.

- **The tabs are named for what they do, and marked.** *Others Inventory* is now **Browse
  Offers**, with a magnifier beside it; **My Requests** has a list, **My Inventory** a box and
  **Requests Received** an inbox tray. The order follows the order the page is used in: browse
  what others share, see what you asked for, look at what you hold, then answer what was asked
  of you - so **My Requests** sits next to **Browse Offers** and **My Inventory** has moved to
  third. Every place that named the old tabs, or sent somebody to Process Requests, now says
  the new name.

- **While you are somebody else, the menu drops the picker and Log out.** Everything else in it
  still works as theirs, because that is the point of looking at their site. Picking a different
  person and logging out both happen after returning to your own menu, where they are again -
  Log out ends the whole session rather than the view, and stepping from one person to another
  goes through your own login first. The list of people is not even fetched while you are
  acting, since nothing draws it, and *Return to my own login* sits where the picker was.
- **The avatar menu scrolls instead of running past the bottom of the window.** The panel hangs
  under the avatar with nothing bounding it, and Log out is its last item, so anything added
  above pushed the way out off the screen with no way to reach it - the view-as block was
  enough to hide it on a short window, and logging out needed a trip back to your own login
  first. The panel now stops short of the window edge and scrolls inside itself.
- **The view-as picker moved to the bottom of the avatar menu and names itself.** Its first
  line reads **View the Site As:** rather than a separate *View the site as another person*
  heading above it, and the whole block now sits just above **Log out** instead of above the
  menu's links. The banner that says whose site is on screen names the person instead of their
  number: *This is the site as workswithdragons sees it* rather than *as #2 sees it*. The picker
  also stays put while you are somebody else, with that person as the line it is on - it used to
  leave out whoever you were looking at, which on a small site emptied the list and took the
  picker away with it, leaving only the way back.
- **The Added count keeps every field below the biggest one that has a value.** It starts at
  the largest field holding anything and writes everything to the right of it, two digits
  each, so an item four days old reads `04d 00h 00m 00s` rather than `04d`, and a month old
  reads `01mo 00d 00h 00m 00s` with the days still there at zero. A `00` never appears to the
  left of a field with a value: two seconds old still reads `02s`, not `00d 00h 00m 02s`. A
  field no longer disappears when it is zero, so nothing drops out and comes back as the count
  rolls over.
- **The upload card names the file the addon writes.** It reads *Upload your GuildsBounty.lua File
  from your Saved Variables Folder Here*, rather than naming the saved-variables file. The file
  it accepts is unchanged: the addon writes `GuildsBounty.lua` into the Saved Variables folder, and
  that is the one to drop on the card.
- **The demo and the simulator build rows the same shape as an upload.** Their fixtures still
  filled in the thirteen fields the tables no longer have, so a demo item and a simulated item
  described data the site cannot store - harmless, because the insert only ever reads the
  column list, but misleading to anybody reading the catalogue and expecting those fields to
  arrive. They are gone from both, and a check in `npm run test:schema` now turns each field a
  demo or simulated item carries into the column it would need and fails if there is no such
  column. The database itself needed nothing: the demo copy is built from the same migrations
  on every start, so it has no such columns either way.
- **The item tables are down to what the site actually uses.** Thirteen columns were stored
  and never read: the numeric item type, the quality's own name, the trait type, the apparel
  and weapon descriptors, the furniture data id, the flavour text, the raw dump of every ESO
  getter and the row's own last-dumped stamp. The addon no longer sends them, so
  `guildsbounty_shared_items` and `guildsbounty_always_share` no longer create them, migration 030
  drops them once, and the parser stops reading them. Everything the list draws - type name,
  quality, trait, set, enchantment, style, level and champion points, location, counts and
  dates - is unchanged.
- **The Added menu gained the windows it was missing, and a way back.** It now reads *Any
  Time*, Last 24 Hours, Last 3 Days, Last 7 Days, Last 2 Weeks, Last 30 Days and **LAST
  CHANCE**, in that order. *Any Time* is first and is the choice that is on when nothing is
  chosen, so a window can be let go of without resetting every other filter - before it,
  there was no way back to "no Added filter" except the reset button. LAST CHANCE keeps its
  warning colour. The Added summary no longer carries a count, since one choice at a time
  could only ever read 1, and the reset button is spelled **RESET**.
- **The site is Guild's Bounty now.** Every page title, the footer, the *Back to ...* buttons,
  the guide, the sign-in card, the demo banner, the header's download button, the request,
  fulfilment and password reset emails, the site's own User-Agent strings, the boot log line,
  the systemd description and the README all name it that way. The addon is Guild's Bounty in
  that copy too: the sign-in hero, the guide and the upload gate all call it that. The download
  button still points at the addon's ESOUI page, which is where the file the site reads comes
  from.

- **ADDED means the day the item was added, not the day it reached this site.** The column,
  the countdown under it, the day filters, the LAST CHANCE pill and the ADDED sort are all
  measured from the date the owner's own file carries for that item - `firstDumpedAt`, kept
  once per item link since 1.11.39 - so an item shared again after a handover, or shared
  from a second character, reads as old instead of looking new. A row whose file carried no
  date at all still falls back to the day this site first saw it, which is what every row
  showed before this.
- **The search and the grouping switch stay put.** They pin under the tab bar the way the
  tabs pin under the site header, so scrolling a long list no longer costs you the box you
  narrow it with or the switch that decides whether it is cut into types. The column
  headings move down to sit under them, so the first row of data never rides up between the
  two bars.
- **The Added count keeps its seconds.** They are written as `00s` on a whole minute
  rather than being left out, so the last field no longer disappears for a moment and comes
  back a second later - the count ticks instead of flickering.

- **Answering a placed furnishing says to rescan the house.** A share that stands in a
  house - `Placed (Mournoth Keep)` - is invisible to every bag, so the site's count is only
  as good as the last `/ishare scan`. The first time in a session that somebody fulfils one,
  a dialog names the house and says to walk into it, run `/ishare scan`, then save and
  upload their saved variables file, because that upload is what puts the new count on the
  site. Once per tab, not once per row.

- **The line above the tabs names the account whose guildmates are listed.** It reads
  *<n> items shared by members of @evainefaye's guilds*: the count is plural for anything
  but one, zero included, and "guild" is singular only when the browsed-as account is in a
  single guild. "different" and "other members" are gone, and a visitor with no account to
  name still reads *shared by members of the guilds they share with*.

- **The empty My Requests tab says where to ask.** It reads *You have no pending requests.
  Use the "Others Inventory" tab to request items*, centred with a little air above it like
  the other empty lists, instead of naming a tab that does not exist by that name.

- **The upload box stands out.** The one place the file goes is tinted blue with a brighter
  dashed edge instead of being another dark panel, so the first step on the page is the
  thing the eye lands on.
- **A standing offer holding nothing stays on My Inventory**, with **0** in OFFERED and
  AVAILABLE. An offer that has run dry used to disappear from both lists; now its owner can
  see it is still standing, while *Others Inventory* goes on leaving it out - nothing is
  there to ask for. A count the file never wrote is still not a row.
- **Standing offers carry the place they are offered from**, and are drawn with the
  inventory table's own columns: TYPE, TRAIT and LOCATION join ADDED, OFFERED, RESERVED,
  AVAILABLE and OFFERED BY, in the same order and at the same widths, so a column of offers
  lines up under the column above it. The addon that records an offer's count also records
  the place it was marked in (1.11.10); a file from an older build leaves that cell blank.
- **The line of tabs and the column headings pin to the top** once a list is long enough
  to scroll: the tabs, then ITEM through OFFERED BY directly under them, as one block, so
  My Inventory and Others Inventory stay reachable and the columns stay named from anywhere
  down the page. Reaching the standing offers hands the pinned row to that heading, and the
  tabs come back when the section has passed.
- **The item column no longer eats the row.** Every column carries a share of the width
  instead of the last one taking all that was left, which had put a wide empty gulf between
  an item's name and ADDED and squeezed OFFERED, RESERVED and AVAILABLE until their own
  headings were cut off. A name still gets the largest share.

- **The account picker is the filter menu now.** *Browsing as* was a native dropdown, and
  the list a browser draws for one is not the site's to style: no dark card, no row that
  lightens under the pointer, no rounded corners - which is why it never looked like the
  **Added** menu it sits above. It is now the same control, down to the classes it is drawn
  with, so the two are styled by one set of rules. Choosing an account still sends the form
  at once, and without scripts the **Switch** button sends it.
- **The account picker matches the other filters.** *Browsing as* was drawn a shade darker
  than the **Added** menu it sits above - one control in two colours. Its box, its hover and
  its caret now come from the same rule as the filter menus, so the two cannot drift apart
  again, and the popup keeps its own opaque option colours.
- **The tabs say whose list you are reading.** *Request* is **Others Inventory**, *Offering*
  is **My Inventory**, and *Your requests* is **My Requests**. Nothing else moved: the
  columns, the buttons and the counts are the ones each tab already had.

- **Browsing as** is a rounded dark menu now, matching the **Added** menu above the lists
  instead of looking like a form control borrowed from the browser: the same height, card
  colour and small caret, and a dark option list.
- **An upload no longer fails because one ESO account in the file belongs to somebody
  else.** That account is left exactly as it was and the rest of the file is stored, so a
  file copied from another player, or a file on a shared computer, still updates the
  accounts that are yours. The upload message names what was updated and what was not, and
  why. A file holding nothing but somebody else's account stores nothing and says so.
- **The two how-to screenshots** are shown at the size they were captured at, centred in the
  column, rather than stretched to its full width: the narrow right-click menu stays as sharp
  as it was captured instead of being blown up, and a picture wider than the column is still
  held to it rather than making the page scroll sideways.
- **How to use GuildsBounty** is two sections now: *Been given a guild code?* for anybody who
  was handed one - sign in, choose **Use Guild Code** at the top of the next screen, and that
  guild's offerings are there, with no addon and no file - and *Adding your own items* for
  people who want their own spares on the site, which is the guide as it was. The same two
  sections open from the sign-in card and the upload box. Step 3 of the addon path carries
  the two game screenshots: the item's right-click menu, then the Shared Items window it
  fills.
- The sign-in card no longer says a file has to be uploaded before there is anything to
  compare against. That stopped being true when guild codes arrived: a code opens its
  guild's items to the account, with no addon, no file and no membership in the guild, so
  the line was telling invited guildmates to do a step they do not need.
- The **Add or remove ESO accounts** dialog only reports until a file has been uploaded.
  Attaching a name by hand, removing one, and the platform and server choices wait for the
  first `GuildsBountySavedVars.lua`: a name typed by hand carries a platform and a world nobody
  has confirmed, and a sign-in with nothing uploaded has no account to record them against.
  Until then the dialog lists the accounts, their guilds and any code-opened slot, and says
  that an upload is what attaches them.
- **Remove** in that dialog is a red destructive button rather than a quiet one.
- The **Added** filter is a single-choice menu now - Any time, the last day, the last 7
  days, the last 30 days, LAST CHANCE - with the same look and behaviour as Type and
  Offered by instead of a native dropdown.
- **LAST CHANCE** is a pill around those two words rather than a bar as wide as the item
  name under it, and the **Added** menu lists its windows as words alone: one choice at a
  time means no radio dots, with the chosen row filled instead.
- The filter card no longer has its own *Item name* box. Each list's **Search this list**
  field does that job, so the address bar carries no `q` parameter any more.
- **Clear filters** is now **Reset**.
