// The "the site has a new name" notice, for somebody who arrived by the old address.
//
// It gets out of the way on its own: ten seconds, or the cross in its corner, whichever comes
// first. Nothing is remembered anywhere - no cookie, no storage - because the notice is about
// the address this visit used, so the next visit by that address should say it again, and a
// visit by the new one never sees it at all.

(() => {
  const notice = document.querySelector('[data-rebrand-notice]');

  if (!notice) {
    return;
  }

  const SECONDS = 10;
  let timer = 0;

  // Removing the element is enough: there is nothing behind it to reset and no state to keep,
  // and a notice that is gone cannot be tabbed back into.
  const close = () => {
    window.clearTimeout(timer);
    notice.remove();
  };

  const button = notice.querySelector('[data-rebrand-close]');

  if (button) {
    button.addEventListener('click', close);
  }

  // The countdown is the page's, not the file's, so it stops when the page goes away.
  timer = window.setTimeout(close, SECONDS * 1000);
})();
