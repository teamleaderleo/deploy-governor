import assert from "node:assert/strict";
import test from "node:test";
import { governBatch, governPush, latestCandidatesForProjects } from "../src/governor.mjs";

function fakeClient(overrides = {}) {
  return {
    hasProductionDeploymentForSha: async () => false,
    countRecentDeployments: async () => 0,
    latestProductionDeployment: async () => null,
    createGitHubProductionDeployment: async (project) => ({ id: `dpl_${project.vercelProject}`, url: `${project.vercelProject}.vercel.app` }),
    ...overrides,
  };
}

const scrapbook = { vercelProject: "setzen", vercelProjectId: "prj_setzen", repo: "teamleaderleo/scrapbook", branch: "main" };
const other = { vercelProject: "other", vercelProjectId: "prj_other", repo: "teamleaderleo/other", branch: "main" };
const shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const shaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const shaC = "cccccccccccccccccccccccccccccccccccccccc";

function candidate(repo, sha, createdAt, runId = 1) {
  return { repo, branch: "main", sha, createdAt, runId };
}

test("push deploys below threshold", async () => {
  let creates = 0;
  const client = fakeClient({
    countRecentDeployments: async () => 49,
    createGitHubProductionDeployment: async () => {
      creates += 1;
      return { id: "dpl_one" };
    },
  });
  const result = await governPush({ client, project: scrapbook, sha: shaA, threshold: 50, now: 1_000_000_000 });
  assert.equal(result.action, "deploy-now");
  assert.equal(creates, 1);
});

test("push does not deploy at threshold", async () => {
  let creates = 0;
  const client = fakeClient({
    countRecentDeployments: async () => 50,
    createGitHubProductionDeployment: async () => {
      creates += 1;
    },
  });
  const result = await governPush({ client, project: scrapbook, sha: shaA, threshold: 50 });
  assert.equal(result.action, "batch-wait");
  assert.equal(creates, 0);
});

test("candidate history coalesces to the newest exact SHA per configured project", () => {
  const result = latestCandidatesForProjects({
    projects: [scrapbook],
    candidates: [
      candidate("teamleaderleo/scrapbook", shaA, "2026-08-24T01:00:00Z", 1),
      candidate("teamleaderleo/scrapbook", shaB, "2026-08-24T02:00:00Z", 2),
      candidate("teamleaderleo/unregistered", shaC, "2026-08-24T03:00:00Z", 3),
    ],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].headSha, shaB);
  assert.equal(result[0].candidateRunId, 2);
});

test("batch mode deploys only the least recently deployed stale project", async () => {
  const created = [];
  const client = fakeClient({
    countRecentDeployments: async () => 50,
    hasProductionDeploymentForSha: async () => false,
    latestProductionDeployment: async ({ project }) => ({ created: project === "prj_setzen" ? 200 : 100 }),
    createGitHubProductionDeployment: async (project) => {
      created.push(project.repo);
      return { id: `dpl_${project.vercelProject}` };
    },
  });
  const result = await governBatch({
    client,
    projects: [scrapbook, other],
    candidates: [
      candidate(scrapbook.repo, shaA, "2026-08-24T02:00:00Z", 2),
      candidate(other.repo, shaB, "2026-08-24T01:00:00Z", 1),
    ],
    threshold: 50,
  });
  assert.equal(result.mode, "batch");
  assert.deepEqual(created, ["teamleaderleo/other"]);
});

test("scheduled draining stays to one project below threshold", async () => {
  const created = [];
  const client = fakeClient({
    countRecentDeployments: async () => 10,
    hasProductionDeploymentForSha: async () => false,
    latestProductionDeployment: async ({ project }) => ({ created: project === "prj_setzen" ? 100 : 200 }),
    createGitHubProductionDeployment: async (project) => {
      created.push(project.repo);
      return { id: `dpl_${project.vercelProject}` };
    },
  });
  const result = await governBatch({
    client,
    projects: [scrapbook, other],
    candidates: [
      candidate(scrapbook.repo, shaA, "2026-08-24T01:00:00Z", 1),
      candidate(other.repo, shaB, "2026-08-24T02:00:00Z", 2),
    ],
    threshold: 50,
  });
  assert.equal(result.mode, "drain");
  assert.deepEqual(created, ["teamleaderleo/scrapbook"]);
});

test("batch ignores candidates whose exact SHA already has a production deployment", async () => {
  const created = [];
  const client = fakeClient({
    countRecentDeployments: async () => 50,
    hasProductionDeploymentForSha: async ({ project }) => project === "prj_setzen",
    latestProductionDeployment: async () => ({ created: 100 }),
    createGitHubProductionDeployment: async (project) => {
      created.push(project.repo);
      return { id: "dpl" };
    },
  });
  await governBatch({
    client,
    projects: [scrapbook, other],
    candidates: [
      candidate(scrapbook.repo, shaA, "2026-08-24T01:00:00Z", 1),
      candidate(other.repo, shaB, "2026-08-24T02:00:00Z", 2),
    ],
  });
  assert.deepEqual(created, ["teamleaderleo/other"]);
});
