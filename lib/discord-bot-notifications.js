// Runs only after the request transaction commits. Keep browser updates ahead of
// email so a mail failure cannot hide a recorded request from its owner.
export function createDiscordSubmissionNotifier({
  announcePendingRequests,
  notifyItemsChanged,
  emailOwners,
}) {
  return async ({ user, submitted, contacts }) => {
    await announcePendingRequests(submitted.map(row => row.owner_account_name));
    notifyItemsChanged('request', 'Discord member submitted a Guild\'s Bounty request');
    await emailOwners({ user, submitted, contacts: new Map(contacts) });
  };
}
