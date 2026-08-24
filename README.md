# deploy-governor

A tiny, stateless governor for Vercel production deployments across multiple GitHub projects.

The default policy is intentionally simple:

- The first **50 Vercel deployments in a rolling 24-hour window** leave production candidates in immediate mode.
- At 50 or more, new routine production candidates wait.
- A single **global batch slot runs every 30 minutes** and deploys at most one stale project.
- The scheduled path can therefore create at most 48 deployments per day. Combined with the 50 immediate threshold, this leaves a little room below Vercel Hobby's 100-deployment rolling limit.
- When the rolling count falls below 50, fresh candidates become immediate again. Existing backlog still drains one project per half-hour instead of bursting.

There is no database and no mutable counter. Vercel's team-wide deployment history is the quota ledger, and deploy-governor's own `repository_dispatch` workflow history is the candidate queue. A small race around 50 is accepted on purpose; 50 is a soft batching threshold, not a distributed lock.

## Normal flow

There are two candidate producers feeding the same decision path:

```text
fast lane when signed webhook coverage exists
GitHub push
  -> Stensibly verifies the push
  -> repository_dispatch to deploy-governor

fallback / reconciliation lane
5-minute governor poll
  -> Vercel says which GitHub repo + production branch belongs to the project
  -> GitHub supplies that branch's current public head
  -> repository_dispatch to deploy-governor when the head is new and not deployed

both lanes
  -> candidate workflow evaluates the exact repo / branch / SHA
  -> below 50: exact-SHA Vercel production deployment now
  -> at 50+: no Vercel deployment yet; the workflow run remains queue evidence
  -> every 30 minutes: deploy the newest pending SHA for one stale project
```

Participating repositories do **not** need a Vercel token or a deploy-governor workflow. The Vercel credential lives in this repository as `VERCEL_TOKEN`.

## Pieces

- `.github/workflows/candidate.yml` receives central `repository_dispatch` candidates and performs the immediate decision.
- `.github/workflows/poll.yml` reconciles enrolled public production heads every five minutes and heals missing webhook coverage.
- `.github/workflows/batch.yml` owns the one global half-hour batch slot.
- `projects.json` is only the enrollment list. Vercel supplies project IDs and production branch names from its existing Git integration.
- `src/policy.mjs` contains the pure threshold and fairness policy.
- `src/vercel.mjs` talks to Vercel and discovers linked project metadata.
- `src/github.mjs` reads public production heads and this repository's candidate workflow history.
- `action.yml` remains available as a direct/manual integration fallback, but it is not the preferred multi-project path.

The project has no runtime dependencies.

## Enroll a project

### 1. Add the repository name centrally

For the ordinary one-Vercel-project-per-repository case, add only the repository:

```json
{
  "repo": "teamleaderleo/scrapbook"
}
```

Deploy-governor resolves the Vercel project ID and production branch from Vercel's existing Git link. If one GitHub repository backs several Vercel projects, add `vercelProject` only to disambiguate them.

No source-repository secret or workflow is required.

### 2. Prove the central candidate path while normal Vercel deploys still work

The candidate workflow is exact-SHA idempotent, so if Vercel's normal Git integration already deployed the SHA it returns `already-current` instead of creating a duplicate. The five-minute poll can provide this proof even when Stensibly has no signed-webhook coverage for that repository.

### 3. Disable Vercel's automatic production branch only

After the central path is proven for that repository, prevent Vercel from creating a production deployment before the governor has made its decision:

```json
{
  "git": {
    "deploymentEnabled": {
      "main": false
    }
  }
}
```

Keep preview branches enabled when the project wants normal preview deployments.

## Queue semantics

Every candidate workflow run is named:

```text
candidate|owner/repo|branch|sha
```

The poller and batch scheduler read that history, keep the newest candidate for each enrolled project, and ask Vercel whether the exact SHA already has a production deployment.

This means:

- repeated observations naturally coalesce to the newest SHA;
- a successful immediate deployment disappears from the pending set by exact-SHA readback;
- an ambiguous immediate attempt is safe to revisit because Vercel readback happens before another deployment is created;
- a failed or canceled Vercel deployment for an exact SHA counts as already attempted, preserving the no-infinite-retry rule;
- a missing signed webhook is repaired by the central poll instead of requiring a repository-local workflow.

## Public and private repositories

The built-in GitHub Actions token in this public governor repository can read public repositories, so public enrolled projects need no extra GitHub credential.

A private repository is different: Vercel's project metadata exposes its repository identity and branch but not the branch's current SHA. Until deploy-governor has one **central** GitHub credential/App installation that can read those private repositories, the poll reports them as `unobservable` and does not disable or replace their existing deployment path.

That is intentionally one central credential problem, not a token copied into every source repository.

## Batch fairness

Every half-hour tick can spend at most one global deployment slot. It picks the stale project with the oldest last production deployment; a project that has never deployed sorts ahead of the others.

## Quota accounting

The rolling count includes preview and production deployments across the Vercel team, including projects outside `projects.json`. Preview deployments are not batched by deploy-governor; the threshold reserve is deliberate headroom for previews, manual deploys, and the accepted race around 50.

## Local verification

```sh
npm test
npm run check
```

A dry run still makes read-only API calls but does not dispatch candidates or create deployments:

```sh
VERCEL_TOKEN=... GITHUB_TOKEN=... \
  GITHUB_REPOSITORY=teamleaderleo/deploy-governor \
  node bin/deploy-governor.mjs poll --config projects.json --dry-run
```
