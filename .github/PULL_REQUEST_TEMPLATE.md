Fixes #

## What does this PR do?

<!-- One or two sentences: the problem and the change. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Documentation
- [ ] CI / DevOps
- [ ] Dependencies

## Test evidence

<!-- Commands you ran and their result (e.g. `npm run validate` ✓, `bun run test` with its pass count), plus any manual check. -->

## Checklist

- [ ] Validation passes in every folder I changed: `cd backend && bun run validate`, `cd frontend && npm run validate`
- [ ] Tested locally
- [ ] Docs updated if behavior changed
- [ ] No stray `console.log`
- [ ] No new comments in code (CLAUDE.md, "No comments in code")

## UI changes

<!-- Delete this section if the PR changes nothing a user sees. Rules: docs/conventions/UIQuality.md -->

| | Before | After |
|---|---|---|
| Desktop 1280px, light | | |
| Desktop 1280px, dark | | |
| Mobile 375px, light | | |
| Mobile 375px, dark | | |

- [ ] Before/after screenshots above at desktop and mobile, or a GIF for motion and multi-step flows
- [ ] Checked against the UI design guide (`docs/conventions/UIQuality.md`): layout, typography, tokens, components, copy
- [ ] All states handled: loading, empty, error, populated, success feedback
- [ ] The screen's question is answered in the first 300px at 375; a new route has a bundle budget
- [ ] No horizontal overflow at 375px; tap targets ≥ 40px
- [ ] Themes checked in light and dark: Default plus two other families (names: …)
- [ ] Keyboard, focus and accessible names checked; axe e2e (`npm run test:e2e`) passing, new routes added to `A11Y_ROUTES`
