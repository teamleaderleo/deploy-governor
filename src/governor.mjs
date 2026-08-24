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

export function latestCandidatesForProjects({ projects, candidates }) {
  const configured = new Map(
    projects.map((project) => [
      `${project.repo.toLowerCase()}|${project.branch}`,
      project,
    ]),
  );
  const latest = new Map();
  const ordered = [...candidates].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt ?? "") || 0;
    const rightTime = Date.parse(right.createdAt ?? "") || 0;
    return rightTime - leftTime || Number(right.runId ?? 0) - Number(left.runId ?? 0);
  });

  for (const candidate of ordered) {
    const key = `${candidate.repo.toLowerCase()}|${candidate.branch}`;
    const project = configured.get(key);
    if (!project || latest.has(key)) continue;
    latest.set(key, {
      ...project,
      headSha: candidate.sha,
      candidateCreatedAt: candidate.createdAt ?? null,
      candidateRunId: candidate.runId ?? null,
    });
  }
  return [...latest.values()];
}

export async function pollProjects({
  client,
  projects,
  candidates,
  getLatestCommit,
  dispatchCandidate,
  governorRepository,
  githubToken,
  dryRun = false,
}) {
  const knownCandidates = new Map(
    latestCandidatesForProjects({ projects, candidates }).map((project) => [
      `${project.repo.toLowerCase()}|${project.branch}`,
      project,
    ]),
  );
  const states = [];
  const dispatched = [];

  for (const project of projects) {
    const key = `${project.repo.toLowerCase()}|${project.branch}`;
    let head;
    try {
      head = await getLatestCommit({
        repo: project.repo,
        branch: project.branch,
        token: githubToken,
      });
    } catch (error) {
      states.push({
        repo: project.repo,
        branch: project.branch,
        vercelProject: project.vercelProject,
        status: "unobservable",
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const alreadyDeployed = await client.hasProductionDeploymentForSha({
      project: project.vercelProjectId,
      sha: head.sha,
    });
    if (alreadyDeployed) {
      states.push({
        repo: project.repo,
        branch: project.branch,
        vercelProject: project.vercelProject,
        headSha: head.sha,
        status: "current",
      });
      continue;
    }

    const candidate = knownCandidates.get(key);
    if (candidate?.headSha === head.sha) {
      states.push({
        repo: project.repo,
        branch: project.branch,
        vercelProject: project.vercelProject,
        headSha: head.sha,
        status: "candidate-recorded",
        candidateRunId: candidate.candidateRunId,
      });
      continue;
    }

    if (!dryRun) {
      const dispatchedCandidate = await dispatchCandidate({
        repository: governorRepository,
        repo: project.repo,
        branch: project.branch,
        sha: head.sha,
        token: githubToken,
      });
      dispatched.push(dispatchedCandidate);
    }
    states.push({
      repo: project.repo,
      branch: project.branch,
      vercelProject: project.vercelProject,
      headSha: head.sha,
      status: dryRun ? "dispatch-needed" : "dispatched",
    });
  }

  return { mode: "poll", states, dispatched, dryRun };
}

export async function governBatch({
  client,
  projects,
  candidates,
  threshold = 50,
  windowHours = 24,
  now = Date.now(),
  dryRun = false,
}) {
  const since = rollingWindowStart(now, windowHours);
  const deploymentCount = await client.countRecentDeployments({ since, threshold });
  const candidateProjects = latestCandidatesForProjects({ projects, candidates });

  const states = [];
  for (const project of candidateProjects) {
    const alreadyDeployed = await client.hasProductionDeploymentForSha({
      project: project.vercelProjectId,
      sha: project.headSha,
    });
    const latest = await client.latestProductionDeployment({ project: project.vercelProjectId });

    states.push({
      ...project,
      alreadyDeployed,
      lastProductionAt: latest?.created ?? latest?.createdAt ?? null,
    });
  }

  const staleProjects = states.filter((project) => !project.alreadyDeployed);
  const selected = selectBatchProjects({ staleProjects });
  const deployments = [];

  for (const project of selected) {
    if (dryRun) {
      deployments.push({
        repo: project.repo,
        vercelProject: project.vercelProject,
        sha: project.headSha,
        dryRun: true,
      });
      continue;
    }
    const deployment = await client.createGitHubProductionDeployment({ ...project, sha: project.headSha });
    deployments.push({
      repo: project.repo,
      vercelProject: project.vercelProject,
      sha: project.headSha,
      deploymentId: deployment?.id ?? deployment?.uid ?? null,
      deploymentUrl: deployment?.url ?? null,
      dryRun: false,
    });
  }

  return {
    mode: deploymentCount >= threshold ? "batch" : "drain",
    deploymentCount,
    staleProjects: staleProjects.map(({
      repo,
      vercelProject,
      headSha,
      candidateCreatedAt,
      candidateRunId,
      lastProductionAt,
    }) => ({
      repo,
      vercelProject,
      headSha,
      candidateCreatedAt,
      candidateRunId,
      lastProductionAt,
    })),
    selected: selected.map(({ repo, vercelProject, headSha }) => ({ repo, vercelProject, headSha })),
    deployments,
    dryRun,
  };
}
