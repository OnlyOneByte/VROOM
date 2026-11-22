# Contributing to VROOM

Thanks for helping. This page is the short version; the details live in the docs it links to.

## Before you code

- Open or pick an issue first. Each pull request handles one issue.
- Set up the app with the [Development Guide](docs/development.md). Sign-in needs your own
  OAuth app, as described in its "Signing in" section.
- Read the coding rules in [`docs/conventions/`](docs/conventions/) for the area you're
  touching. [`CLAUDE.md`](CLAUDE.md) is the one-page summary: commands, architecture, and the
  rules that matter most. It's written for AI coding agents, and it works just as well for
  people.

## Making the change

- Branch from `main`, and use [conventional commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:` and so on).
- Don't add code comments. `backend/src/__tests__/no-code-comments.test.ts` fails CI on any
  comment outside its allowlist, and the few allowed cases are listed under "No comments in
  code" in [`CLAUDE.md`](CLAUDE.md).
- Add or update tests with the change ([`docs/conventions/Testing.md`](docs/conventions/Testing.md)).
- Run validation in every folder you changed, and fix everything it reports:

  ```bash
  cd backend  && bun run all:fix && bun run validate
  cd frontend && npm run all:fix && npm run validate
  ```

## Opening the pull request

- Fill in the [pull request template](.github/PULL_REQUEST_TEMPLATE.md), and put `Fixes #N`
  on its first line so the merge closes the issue.
- UI changes need before/after screenshots at desktop and mobile width, or a GIF for motion,
  checked against [`docs/conventions/UIQuality.md`](docs/conventions/UIQuality.md).
- CI must pass (Backend Tests and Frontend Tests) and the PR needs a review before it merges.

Security problems go through [SECURITY.md](SECURITY.md), not public issues.
