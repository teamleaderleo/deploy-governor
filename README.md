# deploy-governor

A tiny, stateless governor for Vercel production deployments across multiple GitHub projects.

The default policy is intentionally simple:

- The first **50 Vercel deployments in a rolling 24-hour window** leave production pushes in immediate mode.
- At 50 or more, new routine production candidates wait.
- A single **global batch slot runs every 30 minutes** and deploys at most one stale project.
- The scheduled path can therefore create at most 48 deployments per day. Combined with the 50 immediate threshold, this leaves a little room below Vercel Hobby's 100-deployment rolling limit.
- When the rolling count falls below 50, fresh pushes become immediate again. Existing backlog still drains one project per half-hour instead of bursting.

There is no database and no mutable counter. Vercel's team-wide deployment history is the quota ledger, and deploy-governor's own `repository_dispatch` workflow history is the candidate queue. A small race around 50 is accepted on purpose; 50 is a soft batching threshold, not a distributed lock.

## Normal flow

The intended producer is Stensibly's already-running signed GitHub webhook path:

```text
GitHub push to a governed production branch
  -> Stensibly verifies and records the push
  -> Stensibly sends repository_dispatch to deploy-governor
  -> candidate workflow evaluates the exact repo / branch / SHA
  -> below 50: exact-SHA Vercel production deployment now
  -> at 50+: no Vercel deployment yet; the workflow run remains queue evidence
  -> every 30 minutes: deploy the newest pending SHA for one stale project
```

Participating repositories do **not** need a Vercel token or a deploy-governor workflow. The Vercel credential lives in this repository as `VERCEL_TOKEN`.

## Pieces

- `.github/workflows/candidate.yml` receives central `repository_dispatch` candidates and performs the immediate decision.
- `.github/workflows/batch.yml` owns the one global half-hour batch slot.
- `projects.json` is the central allowlist mapping GitHub repositories to Vercel projects.
- `src/policy.mjs` contains the pure threshold and fairness policy.
- `src/vercel.mjs` talks to Vercel.
- `src/github.mjs` reads this repository's candidate workflow history; it does not need access to participating repositories.
- `action.yml` remains available as a direct/manual integration fallback, but it is not the preferred multi-project path.

The project has no runtime dependencies.

## Onboard a project

### 1. Register it centrally

Add the GitHub repository, production branch, Vercel project name, and Vercel project ID to `projects.json`.

### 2. Prove candidate dispatch while normal Vercel deploys still work

Send a `vercel-deploy-candidate` repository dispatch containing:

```json
{
  "repository": "teamleaderleo/scrapbook",
  "branch": "main",
  "sha": "<40-character Git SHA>"
}
```

The candidate workflow is exact-SHA idempotent, so if Vercel's normal Git integration already deployed that SHA it returns `already-current` instead of creating a duplicate.

### 3. Disable Vercel's automatic production branch only

After the dispatch path is proven, prevent Vercel from creating a production deployment before the governor has made its decision:

```json
{
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  }
}
```

Other branches remain available for normal preview deployments.

## Queue semantics

Every candidate workflow run is named:

```text
candidate|owner/repo|branch|sha
```

The batch scheduler reads only its own workflow history, validates that name, discards unregistered projects, and keeps the newest candidate for each configured project. It then asks Vercel whether that exact SHA already has any production deployment.

This means:

- private repositories need no cross-repository read token;
- repeated pushes naturally coalesce to the newest SHA;
- a successful immediate deployment disappears from the pending set by exact-SHA readback;
- an ambiguous immediate attempt is safe to revisit because Vercel readback happens before another deployment is created;
- a failed or canceled Vercel deployment for an exact SHA counts as already attempted, preserving the existing no-infinite-retry rule.

## Batch fairness

Every half-hour tick can spend at most one global deployment slot. It picks the stale project with the oldest last production deployment; a project that has never deployed sorts ahead of the others.

## Quota accounting

The rolling count includes preview and production deployments across the Vercel team, including projects outside `projects.json`. Preview deployments are not batched by deploy-governor; the threshold reserve is deliberate headroom for previews, manual deploys, and the accepted race around 50.

## Local verification

```sh
npm test
npm run check
```

A dry run still makes read-only API calls but does not create deployments:

```sh
VERCEL_TOKEN=... GITHUB_TOKEN=... \
  GITHUB_REPOSITORY=teamleaderleo/deploy-governor \
  node bin/deploy-governor.mjs batch --config projects.json --dry-run
```
