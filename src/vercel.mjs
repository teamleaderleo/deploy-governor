const API = "https://api.vercel.com";

export class VercelClient {
  constructor({ token, teamSlug, fetchImpl = globalThis.fetch }) {
    if (!token) throw new Error("VERCEL_TOKEN is required.");
    if (!teamSlug) throw new Error("A Vercel team slug is required.");
    if (!fetchImpl) throw new Error("fetch is unavailable.");
    this.token = token;
    this.teamSlug = teamSlug;
    this.fetch = fetchImpl;
  }

  async request(path, { method = "GET", query = {}, body } = {}) {
    const url = new URL(path, API);
    url.searchParams.set("slug", this.teamSlug);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "deploy-governor",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
      throw new Error(`Vercel ${method} ${url.pathname} failed (${response.status}): ${detail}`);
    }

    return payload;
  }

  async listDeployments({ since, limit = 100, project, sha, target } = {}) {
    const payload = await this.request("/v7/deployments", {
      query: {
        target,
        since,
        limit,
        projectId: project,
        sha,
      },
    });
    return payload?.deployments ?? [];
  }

  async countRecentDeployments({ since, limit = 100 }) {
    const deployments = await this.listDeployments({ since, limit });
    return deployments.length;
  }

  async listProjects({ limit = 100 } = {}) {
    const payload = await this.request("/v9/projects", { query: { limit } });
    return payload?.projects ?? [];
  }

  async listGitRepositories() {
    const payload = await this.request("/v1/integrations/search-repo", {
      query: { provider: "github" },
    });
    return payload?.repos ?? [];
  }

  async discoverGitLinkedProjects({ githubOwners = [], managedRepositories = [] } = {}) {
    const ownerAllowlist = new Set(githubOwners.map((owner) => owner.toLowerCase()));
    const managedAllowlist = new Set(managedRepositories.map((repo) => repo.toLowerCase()));
    const [projects, repositories] = await Promise.all([
      this.listProjects(),
      this.listGitRepositories(),
    ]);
    const repositoriesById = new Map(
      repositories.map((repository) => [String(repository.id), repository]),
    );
    const eligible = [];
    const skipped = [];

    for (const project of projects) {
      const link = project?.link;
      if (!link || link.type !== "github") {
        skipped.push({ vercelProject: project?.name ?? null, reason: "not-git-linked" });
        continue;
      }
      const org = String(link.org ?? "");
      const repo = `${org}/${link.repo}`;
      if (ownerAllowlist.size > 0 && !ownerAllowlist.has(org.toLowerCase())) {
        skipped.push({ vercelProject: project.name, repo, reason: "owner-not-allowed" });
        continue;
      }
      if (managedAllowlist.size > 0 && !managedAllowlist.has(repo.toLowerCase())) {
        skipped.push({ vercelProject: project.name, repo, reason: "not-managed" });
        continue;
      }
      const repository = repositoriesById.get(String(link.repoId));
      if (!repository) {
        skipped.push({ vercelProject: project.name, repo, reason: "git-repository-not-visible" });
        continue;
      }
      const productionBranch = link.productionBranch;
      const defaultBranch = repository.defaultBranch;
      if (!productionBranch || !defaultBranch || productionBranch !== defaultBranch) {
        skipped.push({
          vercelProject: project.name,
          repo,
          productionBranch: productionBranch ?? null,
          defaultBranch: defaultBranch ?? null,
          reason: "production-branch-not-default",
        });
        continue;
      }
      const repoUpdatedAt = numericTimestamp(repository.updatedAt);
      if (repoUpdatedAt === null) {
        skipped.push({ vercelProject: project.name, repo, reason: "missing-repository-cursor" });
        continue;
      }
      eligible.push({
        vercelProject: project.name,
        vercelProjectId: project.id,
        repo,
        repoId: String(link.repoId),
        branch: productionBranch,
        repoUpdatedAt,
        repoPrivate: Boolean(repository.private),
        rootDirectory: project.rootDirectory ?? null,
      });
    }

    return { eligible, skipped };
  }

  async hasProductionDeploymentForSha({ project, sha }) {
    if (!sha) return false;
    const deployments = await this.listDeployments({ project, sha, target: "production", limit: 1 });
    return deployments.length > 0;
  }

  async latestProductionDeployment({ project }) {
    const [deployment] = await this.listDeployments({ project, target: "production", limit: 1 });
    return deployment ?? null;
  }

  async createGitHubProductionDeployment({ vercelProject, vercelProjectId, repo, branch = "main", sha }) {
    const [org, repoName] = repo.split("/");
    if (!org || !repoName) throw new Error(`Invalid GitHub repository: ${repo}`);

    return this.request("/v13/deployments", {
      method: "POST",
      body: {
        name: vercelProject,
        project: vercelProjectId,
        target: "production",
        gitSource: {
          type: "github",
          org,
          repo: repoName,
          ref: branch,
          ...(sha ? { sha } : {}),
        },
      },
    });
  }
}

export function deploymentRepoPushedAt(deployment) {
  return numericTimestamp(deployment?.meta?.repoPushedAt);
}

function numericTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
