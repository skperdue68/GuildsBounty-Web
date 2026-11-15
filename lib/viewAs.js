// Looking at the site as somebody else.
//
// This is a test tool, not a feature: it lets the person who runs the site see exactly what
// one member sees - their guilds, their shelf, their requests, their empty states - without
// being handed that member's password. Because it hands over another person's view of the
// site, it is tied to a single Discord handle rather than to a role or a setting, and the
// routes that act on it answer every other person with the same 404 the site gives for a
// page that does not exist. Nothing on the site advertises that it is there.
//
// Discord is required as well as the name. A Google or email sign-in that happens to be
// called the same thing is somebody else entirely, and a handle on another provider proves
// nothing about who is holding it.

export const VIEW_AS_USERNAME = 'evainefaye';

/** The words the header uses for a provider, for a session rebuilt for somebody else. */
const PROVIDER_LABELS = {
  discord: 'Discord',
  google: 'Google',
  password: 'email and password',
};

export function providerLabelFor(provider) {
  return PROVIDER_LABELS[String(provider || '')] || 'their account';
}

/**
 * The people a menu lists, best first: alphabetical and ignoring case, with the id breaking a
 * tie so two people called the same thing never swap places between page loads.
 *
 * The database is asked for this order too, but it is sorted here as well: a menu is read by a
 * person looking for a name, and a database collation that is not what they expect - or a
 * query that loses its ORDER BY to a later edit - should not be what decides it. A row with no
 * name at all still appears, as its id, because it is still somebody who can be looked at.
 */
export function arrangeForMenu(people) {
  return (people || [])
    .map((person) => {
      const id = Number(person && person.id);
      const name = String((person && person.name) || '').trim();

      return { id, name: name || `#${id}` };
    })
    .filter((person) => Number.isInteger(person.id) && person.id > 0)
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }) || left.id - right.id
    );
}

/**
 * Whether this signed-in person may look at the site as somebody else.
 *
 * Only the handle above, and only through Discord. Matched without regard to case, because
 * a Discord display name keeps whatever capitals its owner typed, but with nothing else
 * loosened: no substring, no other provider, and no answer but a plain yes or no.
 *
 * @param {{provider?: string, username?: string}|null} user the person who really signed in
 */
export function isViewAsOperator(user) {
  if (!user || user.provider !== 'discord') {
    return false;
  }

  return String(user.username || '').trim().toLowerCase() === VIEW_AS_USERNAME;
}
