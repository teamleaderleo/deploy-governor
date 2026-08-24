# deploy-governor

A tiny, stateless governor for Vercel production deployments across multiple GitHub projects.

The default policy is intentionally simple:

- The first **50 Vercel deployments in a rolling 24-hour window** leave production pushes in immediate mode.
- At 50 or more, new pushes stop creating production deployments immediately.
- A single **global batch slot runs every 30 minutes** and deploys at most one stale project while batching is active.
- Because there are at most 48 half-hour slots in 24 hours, the intended steady-state ceiling is roughly 50 immediate + 48 batched deployments, leaving a little room below Vercel Hobby's 100-deployment rolling limit.
- If the rolling count drops below 50 while projects are stale, the scheduler can use the newly available immediate capacity to catch them up.

There is no database and no counter to synchronize. Vercel's team-wide deployment history is the rolling ledger. A small race around the threshold is accepted on purpose; 50 is a soft batching threshold, not a distributed lock.

## Pieces

- `action.yml` is the push-time gate used by participating repositories.
- `.github/workflows/batch.yml` owns the one global half-hour batch slot.
- `projects.json` is the registry the batch scheduler scans.
- `src/policy.mjs` contains the pure threshold and fairness policy.
- `src/vercel.mjs` and `src/github.mjs` are small API clients built on Node's native `fetch`.

The project has no runtime dependencies.

## Onboard a project

### 1. Register it

Add the GitHub repository, production branch, Vercel project name, and Vercel project ID to `projects.json`.

### 2. Add the push gate

Add a `VERCEL_TOKEN` repository secret to the participating GitHub repository, then add a workflow like:

```yaml
name: Govern production deploy

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: teamleaderleo/deploy-governor@main
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          team-slug: leo-lis-projects
          vercel-project: setzen
          vercel-project-id: prj_6xVAKEVJ3LQUCpSfRzxXFkKjGlsx
```

The action checks whether the exact pushed SHA already has a production deployment, checks the team-wide rolling deployment count, and either creates an exact-SHA production deployment or leaves the commit for batching.

### 3. Disable automatic production Git deploys only

Once the push gate is proven, disable Vercel's automatic Git deployment for the production branch while leaving preview branches alone:

```json
{
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  }
}
```

Do this only after the governor path is working. Otherwise pushes to `main` will stop reaching production.

### 4. Enable the global scheduler

Add `VERCEL_TOKEN` as a repository secret on **this** repository. The scheduled workflow intentionally does nothing while that secret is absent.

For public GitHub repositories, this repository's normal `GITHUB_TOKEN` can read branch heads. If private repositories are later registered, use a GitHub token that can read those repositories instead.

## Batch fairness

When batching is active, each half-hour tick picks only one stale project. The project with the oldest last production deployment goes first; a project that has never deployed sorts ahead of the others. This gives multiple active projects a simple round-robin-ish fairness without persistent state.

## Safety and idempotency

The governor deploys an exact Git SHA through Vercel's deployment API. Before creating anything it checks whether that SHA already has a production deployment. Failed or canceled deployments still count as "seen" for automatic idempotency so a broken commit does not burn a new deployment every 30 minutes forever; retry it explicitly or push a new commit.

The rolling count includes preview and production deployments across the Vercel team, including projects outside `projects.json`, so the threshold tracks the quota it is protecting. Preview deployments are not batched by the governor; the 50-deployment reserve is deliberate headroom for them, manual deploys, and threshold races.

## Local verification

```sh
npm test
npm run check
```

A dry run still makes read-only API calls but does not create deployments:

```sh
VERCEL_TOKEN=... node bin/deploy-governor.mjs batch --config projects.json --dry-run
```
