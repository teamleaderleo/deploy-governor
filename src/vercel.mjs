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

  async countRecentDeployments({ since, threshold }) {
    const deployments = await this.listDeployments({ since, limit: threshold });
    return deployments.length;
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
          sha,
        },
      },
    });
  }
}
