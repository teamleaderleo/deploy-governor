import { decidePush, selectBatchProjects } from "./policy.mjs";

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
        threshold,
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

export async function governBatch({
  client,
  projects,
  getLatestCommit,
  githubToken,
  threshold = 50,
  windowHours = 24,
  now = Date.now(),
  dryRun = false,
}) {
  const since = rollingWindowStart(now, windowHours);
  const deploymentCount = await client.countRecentDeployments({ since, threshold });

  const states = [];
  for (const project of projects) {
    const head = await getLatestCommit({
      repo: project.repo,
      branch: project.branch,
      token: githubToken,
    });
    const alreadyDeployed = await client.hasProductionDeploymentForSha({
      project: project.vercelProjectId,
      sha: head.sha,
    });
    const latest = await client.latestProductionDeployment({ project: project.vercelProjectId });

    states.push({
      ...project,
      headSha: head.sha,
      headCommittedAt: head.committedAt,
      alreadyDeployed,
      lastProductionAt: latest?.created ?? latest?.createdAt ?? null,
    });
  }

  const staleProjects = states.filter((project) => !project.alreadyDeployed);
  const selected = selectBatchProjects({ staleProjects, deploymentCount, threshold });
  const deployments = [];

  for (const project of selected) {
    if (dryRun) {
      deployments.push({ repo: project.repo, vercelProject: project.vercelProject, dryRun: true });
      continue;
    }
    const deployment = await client.createGitHubProductionDeployment({ ...project, sha: project.headSha });
    deployments.push({
      repo: project.repo,
      vercelProject: project.vercelProject,
      deploymentId: deployment?.id ?? deployment?.uid ?? null,
      deploymentUrl: deployment?.url ?? null,
      dryRun: false,
    });
  }

  return {
    mode: deploymentCount >= threshold ? "batch" : "immediate-recovery",
    deploymentCount,
    staleProjects: staleProjects.map(({ repo, vercelProject, headSha, lastProductionAt }) => ({
      repo,
      vercelProject,
      headSha,
      lastProductionAt,
    })),
    selected: selected.map(({ repo, vercelProject }) => ({ repo, vercelProject })),
    deployments,
    dryRun,
  };
}
