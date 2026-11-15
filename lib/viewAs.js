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
