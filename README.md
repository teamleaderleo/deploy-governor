# deploy-governor

A tiny, stateless governor for Vercel production deployments across multiple GitHub projects.

The default policy is intentionally simple:

- The first **75 Vercel deployments in a rolling 24-hour window** leave production candidates in immediate mode.
- At 75 or more, new routine production candidates wait.
- A short-lived global evaluator runs every five minutes and deploys at most one stale project when the next pressure-controlled slot is open.
- Slot spacing grows with the rolling count: 5, 10, 15, 30, 60, 120, then 240 minutes. At 99 deployments, the scheduler waits for enough history to leave the 24-hour window before it can create another.
- When the rolling count falls below 75, fresh candidates become immediate again. Existing backlog still drains through global slots instead of bursting.

There is no database, resident process, or mutable counter. Vercel's team-wide deployment history is the quota ledger, and deploy-governor's own `repository_dispatch` workflow history is the candidate queue. A small race around 75 is accepted on purpose; 75 is a soft batching threshold, not a distributed lock. The scheduler keeps one slot below Vercel Hobby's 100-deployment rolling limit as an additional race reserve.

## Normal flow

Production admission is event-driven:

```text
GitHub main changes
  -> ordinary GitHub Actions CI runs
  -> successful completed GitHub Actions check suite
  -> Stensibly verifies the signed GitHub webhook
  -> Stensibly sends repository_dispatch to deploy-governor
  -> candidate workflow evaluates the exact repo / branch / SHA
  -> below 75: exact-SHA Vercel production deployment now
  -> at 75+: no Vercel deployment yet; the workflow run remains queue evidence
  -> every 5 minutes: recompute the next global slot from actual Vercel history
  -> when eligible: deploy the newest pending SHA for one stale project
```

When a GitHub App installation also supplies raw `push` webhooks, Stensibly may send the same candidate earlier. Exact-SHA readback makes duplicate observations harmless.

There is **no production-head polling loop**.

Participating repositories do **not** need a Vercel token or a deploy-governor workflow. The Vercel credential lives in this repository as `VERCEL_TOKEN`. The source-side event authority is Stensibly's existing GitHub App installation, not a secret copied into every repository.

## Pieces

- `.github/workflows/candidate.yml` receives central `repository_dispatch` candidates and performs the immediate decision.
- `.github/workflows/batch.yml` owns the one global pressure-controlled backlog slot.
- `projects.json` is only the enrollment list. Vercel supplies project IDs and production branch names from its existing Git integration.
- `src/policy.mjs` contains the pure threshold and fairness policy.
- `src/vercel.mjs` talks to Vercel and discovers linked project metadata.
- `src/github.mjs` reads this repository's candidate workflow history for batching.
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

### 2. Give the central event source coverage

The repository must be covered by the Stensibly GitHub App installation so signed GitHub Actions check-suite completion events reach the existing Stensibly webhook ingress. No Vercel credential belongs in the source repository or in Stensibly.

### 3. Disable Vercel's automatic production branch only

After the event path is proven for that repository, prevent Vercel from creating a production deployment before the governor has made its decision:

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

The batch scheduler reads that history, keeps the newest candidate for each enrolled project, and asks Vercel whether the exact SHA already has a production deployment.

This means:

- repeated event deliveries naturally coalesce to the newest SHA;
- a successful immediate deployment disappears from the pending set by exact-SHA readback;
- an ambiguous immediate attempt is safe to revisit because Vercel readback happens before another deployment is created;
- a failed or canceled Vercel deployment for an exact SHA counts as already attempted, preserving the no-infinite-retry rule.

## Batch timing and fairness

Every five-minute tick is a short-lived evaluation. It computes the next slot from the latest team-wide deployment and the current rolling count. Backoff starts at five minutes and increases as the count approaches 99. At the reserve, the next slot is the later of the pressure backoff or the time enough old deployments leave the 24-hour window.

An eligible tick can spend at most one global deployment slot. It picks the stale project with the oldest last production deployment; a project that has never deployed sorts ahead of the others. A manual workflow dispatch may set `force=true` to bypass timing deliberately, while exact-SHA readback and one-project selection still apply.

## Visibility

Candidate and batch runs publish a GitHub Actions job summary and notice with the observed count, immediate threshold, decision, queued commits, selected project, deployment link, and the computed next slot. The JSON log remains available for automation and exact audit details.

## Quota accounting

The rolling count includes preview and production deployments across the Vercel team, including projects outside `projects.json`. Preview deployments are not batched by deploy-governor; the gap between the 75 immediate threshold and the 99 hard reserve is deliberate headroom for previews, manual deploys, and the accepted race around the soft threshold.

## Local verification

```sh
npm test
npm run check
```
