import { decidePush, selectBatchProjects } from "./policy.mjs";
import { deploymentRepoPushedAt } from "./vercel.mjs";

export function rollingWindowStart(now, windowHours) {
  return now - windowHours * 60 * 60 * 1000;
}

export async function governPush({
  client,
  project,
  sha,
  threshold = 50,
  windowHours = 24,
  now = Date.now(),
  dryRun = false,
}) {
  const alreadyDeployed = await client.hasProductionDeploymentForSha({
    project: project.vercelProjectId,
    sha,
  });

  const deploymentCount = alreadyDeployed
    ? null
    : await client.countRecentDeployments({
        since: rollingWindowStart(now, windowHours),
        limit: threshold,
      });

  const decision = decidePush({
    deploymentCount: deploymentCount ?? 0,
    threshold,
    alreadyDeployed,
  });

  if (decision.action !== "deploy-now" || dryRun) {
    return { ...decision, deploymentCount, dryRun };
  }

  const deployment = await client.createGitHubProductionDeployment({ ...project, sha });
  return {
    ...decision,
    deploymentCount,
    deploymentId: deployment?.id ?? deployment?.uid ?? null,
    deploymentUrl: deployment?.url ?? null,
    dryRun,
  };
}

export async function discoverVercelProjectStates({ client, githubOwners = [] }) {
  const discovery = await client.discoverGitLinkedProjects({ githubOwners });
  const states = await Promise.all(
    discovery.eligible.map(async (project) => {
      const latest = await client.latestProductionDeployment({
        project: project.vercelProjectId,
      });
      const repoPushedAt = deploymentRepoPushedAt(latest);
      const deploymentCreatedAt = numericTimestamp(latest?.created ?? latest?.createdAt);
      const coveredAt = repoPushedAt ?? deploymentCreatedAt;
      return {
        ...project,
        latestDeploymentId: latest?.id ?? latest?.uid ?? null,
        latestDeploymentState: latest?.state ?? latest?.readyState ?? null,
        lastProductionAt: deploymentCreatedAt,
        lastRepoPushedAt: repoPushedAt,
        coveredAt,
        stale: coveredAt === null || project.repoUpdatedAt > coveredAt,
      };
    }),
  );
  return { states, skipped: discovery.skipped };
}

export async function governPoll({
  client,
  githubOwners = [],
  threshold = 50,
  windowHours = 24,
  now = Date.now(),
  dryRun = false,
}) {
  const since = rollingWindowStart(now, windowHours);
  const [deploymentCount, discovery] = await Promise.all([
    client.countRecentDeployments({ since, limit: threshold }),
    discoverVercelProjectStates({ client, githubOwners }),
  ]);
  const staleProjects = discovery.states
    .filter((project) => project.stale)
    .sort((left, right) => left.repoUpdatedAt - right.repoUpdatedAt || left.repo.localeCompare(right.repo));
  const capacity = Math.max(0, threshold - deploymentCount);
  const selected = staleProjects.slice(0, capacity);
  const deployments = await deploySelected({ client, selected, dryRun });

  return {
    mode: deploymentCount < threshold ? "immediate" : "batch-wait",
    deploymentCount,
    threshold,
    capacity,
    staleProjects: summarize(staleProjects),
    selected: summarize(selected),
    deployments,
    skipped: discovery.skipped,
    dryRun,
  };
}

export async function governBatch({
  client,
  githubOwners = [],
  hardCeiling = 98,
  windowHours = 24,
  now = Date.now(),
  dryRun = false,
}) {
  const since = rollingWindowStart(now, windowHours);
  const [deploymentCount, discovery] = await Promise.all([
    client.countRecentDeployments({ since, limit: hardCeiling }),
    discoverVercelProjectStates({ client, githubOwners }),
  ]);
  const staleProjects = discovery.states.filter((project) => project.stale);
  const selected = deploymentCount >= hardCeiling
    ? []
    : selectBatchProjects({ staleProjects });
  const deployments = await deploySelected({ client, selected, dryRun });

  return {
    mode: deploymentCount >= hardCeiling ? "hard-hold" : "batch",
    deploymentCount,
    hardCeiling,
    staleProjects: summarize(staleProjects),
    selected: summarize(selected),
    deployments,
    skipped: discovery.skipped,
    dryRun,
  };
}

async function deploySelected({ client, selected, dryRun }) {
  const deployments = [];
  for (const project of selected) {
    if (dryRun) {
      deployments.push({
        repo: project.repo,
        vercelProject: project.vercelProject,
        branch: project.branch,
        dryRun: true,
      });
      continue;
    }
    const deployment = await client.createGitHubProductionDeployment(project);
    deployments.push({
      repo: project.repo,
      vercelProject: project.vercelProject,
      branch: project.branch,
      deploymentId: deployment?.id ?? deployment?.uid ?? null,
      deploymentUrl: deployment?.url ?? null,
      dryRun: false,
    });
  }
  return deployments;
}

function summarize(projects) {
  return projects.map(({
    repo,
    vercelProject,
    vercelProjectId,
    branch,
    repoUpdatedAt,
    lastRepoPushedAt,
    lastProductionAt,
    latestDeploymentId,
  }) => ({
    repo,
    vercelProject,
    vercelProjectId,
    branch,
    repoUpdatedAt,
    lastRepoPushedAt,
    lastProductionAt,
    latestDeploymentId,
  }));
}

function numericTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
