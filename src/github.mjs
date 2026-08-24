const API = "https://api.github.com";

export async function getLatestCommit({ repo, branch = "main", token, fetchImpl = globalThis.fetch }) {
  const url = new URL(`/repos/${repo}/commits/${encodeURIComponent(branch)}`, API);
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "deploy-governor",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(url, { headers });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`GitHub GET ${url.pathname} failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return {
    sha: payload.sha,
    committedAt: payload.commit?.committer?.date ?? payload.commit?.author?.date ?? null,
  };
}
