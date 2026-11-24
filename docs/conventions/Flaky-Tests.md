# Flaky tests

A flaky test is one that fails, then passes on the same code. It is a bug in the test or in the code. It is never "just CI".

## The rule

When a test fails and the failure has no cause in the change being tested, **the owner of the test fixes it or quarantines it the same day**. The owner is the author of the test's last substantive change, or the person who next touches that area.

- **Fix:** find the race or the shared state and remove it. For example:
  - wait for the state you assert on, not for time;
  - give each test its own data;
  - don't depend on test order.

  `docs/conventions/Testing.md` has the patterns.
- **Quarantine:** when a fix needs more than a day, take the test out of the required checks (below). Open an issue labelled `flaky`, with the run link, the failing assertion, and what you know so far. Link the issue from the test.
- **Never:**
  - add retries or raise a timeout to make it pass;
  - skip it without an issue;
  - re-run CI until it goes green and move on.

  A hidden flake fails someone else's PR next week.

## Quarantine

| Suite | How to quarantine | Where it still runs |
|---|---|---|
| Playwright (`frontend/e2e/`) | Add `@quarantine` to the test's title, and the `flaky` issue number to its body | The **Quarantined E2E** job, which isn't a required check. The required E2E shards run with `--grep-invert @quarantine` |
| Vitest (`frontend/src`) and `bun test` (`backend/`) | `test.skip`, with the `flaky` issue number in the test name | Nowhere until it's fixed, so fix these first |

Remove the tag or the `skip` in the PR that fixes the test, and close the issue there.

## Finding flakes

CI runs Playwright with up to 2 retries (`frontend/playwright.config.ts`). A test that failed and then passed on a retry is marked **flaky**. Each E2E job lists those tests under "Passed only on retry" in its job summary, and adds a warning annotation to the run. A flaky entry there is a failure with no code cause: report it and apply the rule above.

To reproduce a flake locally, run the test many times with no retries:

```bash
cd frontend
npx playwright test e2e/<file>.spec.ts --project=chromium --retries=0 --repeat-each=20 --workers=1
# a whole file, or one test with -g "<title>"
npx vitest run src/<path>.test.ts --repeats 20     # Vitest
cd ../backend && bun test <file> --rerun-each 20   # bun test
```

A flake that only shows under load may need CPU throttling or a parallel load to show up. Show the fix with the same repeat count failing before the fix and passing after it, and put both runs in the PR.
