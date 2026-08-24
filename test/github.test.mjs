import assert from "node:assert/strict";
import test from "node:test";
import { listDispatchCandidates, parseCandidateRunName } from "../src/github.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";

test("candidate run names carry exact repository, branch, and SHA", () => {
  assert.deepEqual(
    parseCandidateRunName(`candidate|teamleaderleo/scrapbook|main|${sha}`),
    { repo: "teamleaderleo/scrapbook", branch: "main", sha },
  );
  assert.equal(parseCandidateRunName("ordinary workflow title"), null);
  assert.equal(parseCandidateRunName("candidate|teamleaderleo/scrapbook|main|not-a-sha"), null);
  assert.equal(parseCandidateRunName(`candidate|bad repo|main|${sha}`), null);
});

test("candidate listing reads only repository-dispatch runs from the governor workflow", async () => {
  let requestedUrl;
  const candidates = await listDispatchCandidates({
    repository: "teamleaderleo/deploy-governor",
    token: "secret",
    fetchImpl: async (url, init) => {
      requestedUrl = url;
      assert.equal(init.headers.Authorization, "Bearer secret");
      return new Response(JSON.stringify({
        workflow_runs: [
          {
            id: 42,
            display_title: `candidate|teamleaderleo/scrapbook|main|${sha}`,
            created_at: "2026-08-24T01:02:03Z",
          },
          { id: 43, display_title: "CI", created_at: "2026-08-24T01:03:03Z" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(requestedUrl.searchParams.get("event"), "repository_dispatch");
  assert.equal(requestedUrl.searchParams.get("per_page"), "100");
  assert.deepEqual(candidates, [{
    repo: "teamleaderleo/scrapbook",
    branch: "main",
    sha,
    runId: 42,
    createdAt: "2026-08-24T01:02:03Z",
  }]);
});
