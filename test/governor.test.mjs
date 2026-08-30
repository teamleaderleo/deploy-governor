import assert from "node:assert/strict";
import test from "node:test";
import {
  governBatch,
  governPush,
  latestCandidatesForProjects,
  pollProjects,
} from "../src/governor.mjs";

function fakeClient(overrides = {}) {
  return {
    hasProductionDeploymentForSha: async () => false,
    countRecentDeployments: async () => 0,
    listDeployments: async () => [],
    latestProductionDeployment: async () => null,
    createGitHubProductionDeployment: async (project) => ({
      id: `dpl_${project.vercelProject}`,
      url: `${project.vercelProject}.vercel.app`,
    }),
    ...overrides,
  };
}

const scrapbook = {
  vercelProject: "setzen",
  vercelProjectId: "prj_setzen",
  repo: "teamleaderleo/scrapbook",
  branch: "main",
};
const other = {
  vercelProject: "other",
  vercelProjectId: "prj_other",
  repo: "teamleaderleo/other",
  branch: "main",
};
const shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const shaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const shaC = "cccccccccccccccccccccccccccccccccccccccc";

function candidate(repo, sha, createdAt, runId = 1) {
  return { repo, branch: "main", sha, createdAt, runId };
}

test("push deploys below threshold", async () => {
  let creates = 0;
  const client = fakeClient({
    listDeployments: async () => Array.from({ length: 49 }, () => ({ created: Date.now() })),
    createGitHubProductionDeployment: async () => {
      creates += 1;
      return { id: "dpl_one" };
    },
  });
  const result = await governPush({
    client,
    project: scrapbook,
    sha: shaA,
    threshold: 50,
    now: 1_000_000_000,
  });
  assert.equal(result.action, "deploy-now");
  assert.equal(creates, 1);
});

test("push does not deploy at threshold", async () => {
  let creates = 0;
  const client = fakeClient({
    listDeployments: async () => Array.from({ length: 50 }, () => ({ created: Date.now() })),
    createGitHubProductionDeployment: async () => {
      creates += 1;
    },
  });
  const result = await governPush({ client, project: scrapbook, sha: shaA, threshold: 50 });
  assert.equal(result.action, "batch-wait");
  assert.match(result.nextSlotAt, /^\d{4}-/);
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

test("poll dispatches only a new stale head", async () => {
  const dispatched = [];
  const client = fakeClient({
    hasProductionDeploymentForSha: async ({ project }) => project === "prj_other",
  });
  const result = await pollProjects({
    client,
    projects: [scrapbook, other],
    candidates: [],
    getLatestCommit: async ({ repo }) => ({
      sha: repo === scrapbook.repo ? shaA : shaB,
      committedAt: null,
    }),
    dispatchCandidate: async (input) => {
      dispatched.push(input);
      return { repo: input.repo, branch: input.branch, sha: input.sha };
    },
    governorRepository: "teamleaderleo/deploy-governor",
    githubToken: "token",
  });

  assert.equal(result.mode, "poll");
  assert.equal(result.states[0].status, "dispatched");
  assert.equal(result.states[1].status, "current");
  assert.deepEqual(dispatched.map(({ repo, sha }) => ({ repo, sha })), [
    { repo: scrapbook.repo, sha: shaA },
  ]);
});

test("poll does not redispatch a head already represented by candidate history", async () => {
  let dispatches = 0;
  const result = await pollProjects({
    client: fakeClient(),
    projects: [scrapbook],
    candidates: [candidate(scrapbook.repo, shaA, "2026-08-24T01:00:00Z", 55)],
    getLatestCommit: async () => ({ sha: shaA, committedAt: null }),
    dispatchCandidate: async () => {
      dispatches += 1;
    },
    governorRepository: "teamleaderleo/deploy-governor",
    githubToken: "token",
  });

  assert.equal(dispatches, 0);
  assert.equal(result.states[0].status, "candidate-recorded");
  assert.equal(result.states[0].candidateRunId, 55);
});

test("poll reports an unobservable repo without blocking other projects", async () => {
  const dispatched = [];
  const result = await pollProjects({
    client: fakeClient(),
    projects: [scrapbook, other],
    candidates: [],
    getLatestCommit: async ({ repo }) => {
      if (repo === scrapbook.repo) throw new Error("GitHub GET failed (404)");
      return { sha: shaB, committedAt: null };
    },
    dispatchCandidate: async (input) => {
      dispatched.push(input.repo);
      return input;
    },
    governorRepository: "teamleaderleo/deploy-governor",
    githubToken: "token",
  });

  assert.equal(result.states[0].status, "unobservable");
  assert.equal(result.states[1].status, "dispatched");
  assert.deepEqual(dispatched, [other.repo]);
});

test("batch mode deploys only the least recently deployed stale project", async () => {
  const created = [];
  const client = fakeClient({
    listDeployments: async () => Array.from({ length: 50 }, () => ({ created: Date.now() })),
    hasProductionDeploymentForSha: async () => false,
    latestProductionDeployment: async ({ project }) => ({
      created: project === "prj_setzen" ? 200 : 100,
    }),
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
    force: true,
  });
  assert.equal(result.mode, "batch");
  assert.deepEqual(created, ["teamleaderleo/other"]);
});

test("batch reports the next slot without deploying early", async () => {
  const now = Date.parse("2026-08-31T12:00:00Z");
  let creates = 0;
  const result = await governBatch({
    client: fakeClient({
      listDeployments: async () => Array.from({ length: 75 }, () => ({ created: now - 60_000 })),
      createGitHubProductionDeployment: async () => {
        creates += 1;
        return { id: "should_not_happen" };
      },
    }),
    projects: [scrapbook],
    candidates: [candidate(scrapbook.repo, shaA, "2026-08-31T11:59:00Z")],
    threshold: 75,
    now,
  });

  assert.equal(result.slotEligible, false);
  assert.equal(result.nextSlotAt, "2026-08-31T12:04:00.000Z");
  assert.equal(result.selected.length, 0);
  assert.equal(creates, 0);
});

test("scheduled draining stays to one project below threshold", async () => {
  const created = [];
  const client = fakeClient({
    listDeployments: async () => [],
    hasProductionDeploymentForSha: async () => false,
    latestProductionDeployment: async ({ project }) => ({
      created: project === "prj_setzen" ? 100 : 200,
    }),
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
    force: true,
  });
  assert.equal(result.mode, "drain");
  assert.deepEqual(created, ["teamleaderleo/scrapbook"]);
});

test("batch ignores candidates whose exact SHA already has a production deployment", async () => {
  const created = [];
  const client = fakeClient({
    listDeployments: async () => [],
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
    force: true,
  });
  assert.deepEqual(created, ["teamleaderleo/other"]);
});
