import assert from "node:assert/strict";
import test from "node:test";
import { governBatch, governPush } from "../src/governor.mjs";

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

test("push deploys below threshold", async () => {
  let creates = 0;
  const client = fakeClient({
    countRecentDeployments: async () => 49,
    createGitHubProductionDeployment: async () => {
      creates += 1;
      return { id: "dpl_one" };
    },
  });
  const result = await governPush({ client, project: scrapbook, sha: "abc", threshold: 50, now: 1_000_000_000 });
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
  const result = await governPush({ client, project: scrapbook, sha: "abc", threshold: 50 });
  assert.equal(result.action, "batch-wait");
  assert.equal(creates, 0);
});

test("batch mode deploys only the least recently deployed stale project", async () => {
  const created = [];
  const projects = [
    scrapbook,
    { vercelProject: "other", vercelProjectId: "prj_other", repo: "teamleaderleo/other", branch: "main" },
  ];
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
    projects,
    getLatestCommit: async ({ repo }) => ({ sha: `sha-${repo}`, committedAt: null }),
    threshold: 50,
  });
  assert.equal(result.mode, "batch");
  assert.deepEqual(created, ["teamleaderleo/other"]);
});

test("batch ignores projects whose current head already has a production deployment", async () => {
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
    projects: [scrapbook, { vercelProject: "other", vercelProjectId: "prj_other", repo: "teamleaderleo/other", branch: "main" }],
    getLatestCommit: async ({ repo }) => ({ sha: `sha-${repo}`, committedAt: null }),
  });
  assert.deepEqual(created, ["teamleaderleo/other"]);
});
