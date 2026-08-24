import assert from "node:assert/strict";
import test from "node:test";
import { VercelClient } from "../src/vercel.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("project discovery reads the Vercel team's linked projects", async () => {
  let seenUrl;
  const client = new VercelClient({
    token: "token",
    teamSlug: "leo-lis-projects",
    fetchImpl: async (url) => {
      seenUrl = new URL(url);
      return response({ projects: [{ id: "prj_one", name: "one" }] });
    },
  });

  assert.deepEqual(await client.listProjects(), [{ id: "prj_one", name: "one" }]);
  assert.equal(seenUrl.pathname, "/v9/projects");
  assert.equal(seenUrl.searchParams.get("slug"), "leo-lis-projects");
  assert.equal(seenUrl.searchParams.get("limit"), "100");
});

test("rolling count is team-wide and includes previews", async () => {
  let seenUrl;
  const client = new VercelClient({
    token: "token",
    teamSlug: "leo-lis-projects",
    fetchImpl: async (url) => {
      seenUrl = new URL(url);
      return response({ deployments: [{ id: "one" }, { id: "two" }] });
    },
  });

  assert.equal(await client.countRecentDeployments({ since: 123, threshold: 50 }), 2);
  assert.equal(seenUrl.searchParams.get("slug"), "leo-lis-projects");
  assert.equal(seenUrl.searchParams.get("since"), "123");
  assert.equal(seenUrl.searchParams.get("limit"), "50");
  assert.equal(seenUrl.searchParams.has("target"), false);
});

test("SHA idempotency checks only production deployments for the exact project", async () => {
  let seenUrl;
  const client = new VercelClient({
    token: "token",
    teamSlug: "leo-lis-projects",
    fetchImpl: async (url) => {
      seenUrl = new URL(url);
      return response({ deployments: [{ id: "dpl" }] });
    },
  });

  assert.equal(await client.hasProductionDeploymentForSha({ project: "prj_one", sha: "abc" }), true);
  assert.equal(seenUrl.searchParams.get("projectId"), "prj_one");
  assert.equal(seenUrl.searchParams.get("sha"), "abc");
  assert.equal(seenUrl.searchParams.get("target"), "production");
});

test("production creation pins the exact SHA and existing project", async () => {
  let requestBody;
  const client = new VercelClient({
    token: "token",
    teamSlug: "leo-lis-projects",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return response({ id: "dpl_new", url: "new.vercel.app" });
    },
  });

  await client.createGitHubProductionDeployment({
    vercelProject: "setzen",
    vercelProjectId: "prj_setzen",
    repo: "teamleaderleo/scrapbook",
    branch: "main",
    sha: "abc123",
  });

  assert.equal(requestBody.project, "prj_setzen");
  assert.equal(requestBody.target, "production");
  assert.deepEqual(requestBody.gitSource, {
    type: "github",
    org: "teamleaderleo",
    repo: "scrapbook",
    ref: "main",
    sha: "abc123",
  });
});
