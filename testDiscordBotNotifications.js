import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordSubmissionNotifier } from './lib/discord-bot-notifications.js';

test('committed bot requests update owner badges and browsers before sending mail', async () => {
  const events = [];
  const submitted = [{ owner_account_name: '@Owner' }, { owner_account_name: '@Other' }];
  const user = { id: 7 };
  const contacts = [['@Owner', { email: 'owner@example.com' }]];
  const notify = createDiscordSubmissionNotifier({
    announcePendingRequests: async names => events.push(['badges', names]),
    notifyItemsChanged: kind => events.push(['browsers', kind]),
    emailOwners: async input => { events.push(['mail', input]); throw new Error('mail unavailable'); },
  });
  await assert.rejects(() => notify({ user, submitted, contacts }), /mail unavailable/);
  assert.deepEqual(events.slice(0, 2), [
    ['badges', ['@Owner', '@Other']], ['browsers', 'request'],
  ]);
  assert.deepEqual(events[2][1], { user, submitted, contacts: new Map(contacts) });
});
