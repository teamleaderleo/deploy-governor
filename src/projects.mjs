const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function normalizedRepo(value) {
  if (typeof value !== "string" || !repoPattern.test(value)) {
    throw new Error(`Invalid GitHub repository: ${value}`);
  }
  return value.toLowerCase();
}

function linkedGitHubProject(project) {
  const link = project?.link;
  if (!project?.id || !project?.name || link?.type !== "github") return null;
  if (!link.org || !link.repo || !link.productionBranch) return null;
  const repo = `${link.org}/${link.repo}`;
  if (!repoPattern.test(repo) || String(link.productionBranch).includes("|")) return null;
  return {
    vercelProject: project.name,
    vercelProjectId: project.id,
    repo,
    branch: link.productionBranch,
    private: Boolean(link.private),
  };
}

export async function resolveProjects({ client, config }) {
  const remoteProjects = await client.listProjects();
  const linked = remoteProjects.map(linkedGitHubProject).filter(Boolean);
  const byRepo = new Map();
  for (const project of linked) {
    const key = project.repo.toLowerCase();
    const entries = byRepo.get(key) ?? [];
    entries.push(project);
    byRepo.set(key, entries);
  }

  const resolved = [];
  for (const enrollment of config.projects) {
    const key = normalizedRepo(enrollment.repo);
    const matches = byRepo.get(key) ?? [];
    const narrowed = enrollment.vercelProject
      ? matches.filter((project) => project.vercelProject === enrollment.vercelProject)
      : matches;
    if (narrowed.length === 0) {
      throw new Error(`No linked Vercel project found for ${enrollment.repo}.`);
    }
    if (narrowed.length > 1) {
      throw new Error(
        `Multiple linked Vercel projects found for ${enrollment.repo}; set vercelProject to disambiguate.`,
      );
    }
    resolved.push(narrowed[0]);
  }
  return resolved;
}
