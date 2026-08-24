const API = "https://api.github.com";
const CANDIDATE_PREFIX = "candidate|";
const shaPattern = /^[a-f0-9]{40}$/;
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function headers(token) {
  const result = {
    Accept: "application/vnd.github+json",
    "User-Agent": "deploy-governor",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

export function parseCandidateRunName(value) {
  if (typeof value !== "string" || !value.startsWith(CANDIDATE_PREFIX)) return null;
  const parts = value.split("|");
  if (parts.length !== 4) return null;
  const [, repo, branch, sha] = parts;
  if (!repoPattern.test(repo) || !branch || branch.includes("|") || !shaPattern.test(sha)) return null;
  return { repo, branch, sha };
}

export async function listDispatchCandidates({
  repository,
  workflow = "candidate.yml",
  token,
  fetchImpl = globalThis.fetch,
  maxPages = 10,
}) {
  if (!repoPattern.test(repository ?? "")) {
    throw new Error(`Invalid governor repository: ${repository}`);
  }
  const candidates = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(
      `/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs`,
      API,
    );
    url.searchParams.set("event", "repository_dispatch");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await fetchImpl(url, { headers: headers(token) });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`GitHub GET ${url.pathname} failed (${response.status}): ${JSON.stringify(payload)}`);
    }
    const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
    for (const run of runs) {
      const parsed = parseCandidateRunName(run.display_title);
      if (!parsed) continue;
      candidates.push({
        ...parsed,
        runId: run.id,
        createdAt: run.created_at ?? null,
      });
    }
    if (runs.length < 100) break;
  }
  return candidates;
}

export async function getLatestCommit({ repo, branch = "main", token, fetchImpl = globalThis.fetch }) {
  const url = new URL(`/repos/${repo}/commits/${encodeURIComponent(branch)}`, API);
  const response = await fetchImpl(url, { headers: headers(token) });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`GitHub GET ${url.pathname} failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return {
    sha: payload.sha,
    committedAt: payload.commit?.committer?.date ?? payload.commit?.author?.date ?? null,
  };
}
