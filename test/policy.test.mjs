import assert from "node:assert/strict";
import test from "node:test";
import { decidePush, selectBatchProjects } from "../src/policy.mjs";

test("pushes deploy immediately below the threshold", () => {
  assert.equal(decidePush({ deploymentCount: 49, threshold: 50, alreadyDeployed: false }).action, "deploy-now");
});

test("the 51st candidate waits once 50 deployments are inside the window", () => {
  assert.equal(decidePush({ deploymentCount: 50, threshold: 50, alreadyDeployed: false }).action, "batch-wait");
});

test("an already deployed commit is idempotent", () => {
  assert.equal(decidePush({ deploymentCount: 50, threshold: 50, alreadyDeployed: true }).action, "already-current");
});

test("the scheduler globally selects only one stale project", () => {
  const selected = selectBatchProjects({
    staleProjects: [
      { repo: "me/newer", lastProductionAt: 200 },
      { repo: "me/older", lastProductionAt: 100 },
      { repo: "me/never", lastProductionAt: null },
    ],
  });
  assert.deepEqual(selected.map((item) => item.repo), ["me/never"]);
});

test("the scheduler never bursts below the threshold", () => {
  const selected = selectBatchProjects({
    staleProjects: [
      { repo: "me/a", lastProductionAt: 100 },
      { repo: "me/b", lastProductionAt: 200 },
      { repo: "me/c", lastProductionAt: 300 },
    ],
  });
  assert.deepEqual(selected.map((item) => item.repo), ["me/a"]);
});
