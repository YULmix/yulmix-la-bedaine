// The `test` every spec imports instead of Playwright's own (#327).
//
// Chromium aborts the requests it has in flight with net::ERR_NETWORK_CHANGED whenever the host's
// network configuration changes, and with several per-worktree Supabase stacks (#312) it changes all
// the time: each container another stack starts or restarts adds or removes a network interface. A
// module or lazy chunk of the app caught in flight is lost, the page never mounts and
// `window.__supabase` never appears (loginAs waits 30 s, then the test fails, in a different spec
// each run).
//
// Requests answered through route.fetch() are made by Node, not Chromium's network stack, so they are
// not affected: the app's and the API's go through it. WebSockets are not routed (route() doesn't see
// them); nothing in the suite depends on one surviving a network change.
//
// A document served by route.fulfill() has no IP address space, so Chromium's Local Network Access
// checks then block its WebSockets (Vite's, Supabase Realtime) and API calls to 127.0.0.1;
// playwright.config.js turns those checks off (--disable-features=LocalNetworkAccessChecks).
import { test as base, expect } from '@playwright/test';

// Idempotent: loginAs calls it too, for the contexts a spec makes itself with browser.newContext().
const routed = new WeakSet();
export async function routeThroughNode(context) {
  if (routed.has(context)) return;
  routed.add(context);
  const origins = [process.env.E2E_BASE_URL, process.env.VITE_SUPABASE_URL]
    .filter(Boolean)
    .map((url) => new URL(url).origin);
  for (const origin of origins) {
    await context.route(`${origin}/**`, async (route) => {
      try {
        await route.fetch().then((response) => route.fulfill({ response }));
      } catch {
        // Test over or page closed mid-request, or Node's fetch failed: let the browser try (and fail
        // quietly if there is nobody left to answer).
        await route.continue().catch(() => {});
      }
    });
  }
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await routeThroughNode(context);
    await use(context);
    await context.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

export { expect };
