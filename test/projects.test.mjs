import assert from "node:assert/strict";
import test from "node:test";
import { resolveProjects } from "../src/projects.mjs";

function project({ id, name, repo, branch = "main", org = "teamleaderleo" }) {
  return {
    id,
    name,
    link: {
      type: "github",
      org,
      repo,
      productionBranch: branch,
    },
  };
}

function client(projects) {
  return { listProjects: async () => projects };
}

test("resolves Vercel identity and production branch from linked project metadata", async () => {
  const projects = await resolveProjects({
    client: client([
      project({ id: "prj_scrapbook", name: "setzen", repo: "scrapbook" }),
      project({
        id: "prj_legend",
        name: "one-more-legend",
        repo: "one-more-legend",
        branch: "claude/uma-musume-game-prototype-l64ora",
      }),
    ]),
    config: {
      projects: [
        { repo: "teamleaderleo/scrapbook" },
        { repo: "teamleaderleo/one-more-legend" },
      ],
    },
  });

  assert.deepEqual(projects, [
    {
      vercelProject: "setzen",
      vercelProjectId: "prj_scrapbook",
      repo: "teamleaderleo/scrapbook",
      branch: "main",
      private: false,
    },
    {
      vercelProject: "one-more-legend",
      vercelProjectId: "prj_legend",
      repo: "teamleaderleo/one-more-legend",
      branch: "claude/uma-musume-game-prototype-l64ora",
      private: false,
    },
  ]);
});

test("rejects an enrolled repository that Vercel does not link", async () => {
  await assert.rejects(
    resolveProjects({
      client: client([]),
      config: { projects: [{ repo: "teamleaderleo/missing" }] },
    }),
    /No linked Vercel project found/,
  );
});

test("requires Vercel project disambiguation when one repo has multiple projects", async () => {
  const remote = [
    project({ id: "prj_a", name: "site-a", repo: "monorepo" }),
    project({ id: "prj_b", name: "site-b", repo: "monorepo" }),
  ];
  await assert.rejects(
    resolveProjects({
      client: client(remote),
      config: { projects: [{ repo: "teamleaderleo/monorepo" }] },
    }),
    /Multiple linked Vercel projects found/,
  );

  const resolved = await resolveProjects({
    client: client(remote),
    config: {
      projects: [{ repo: "teamleaderleo/monorepo", vercelProject: "site-b" }],
    },
  });
  assert.equal(resolved[0].vercelProjectId, "prj_b");
});
