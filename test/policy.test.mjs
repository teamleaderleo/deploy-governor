import assert from "node:assert/strict";
import test from "node:test";
import {
  batchBackoffMinutes,
  decidePush,
  nextBatchSlot,
  selectBatchProjects,
} from "../src/policy.mjs";

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

test("batch pressure backoff grows toward the rolling limit", () => {
  assert.equal(batchBackoffMinutes({ deploymentCount: 75, threshold: 75 }), 5);
  assert.equal(batchBackoffMinutes({ deploymentCount: 80, threshold: 75 }), 10);
  assert.equal(batchBackoffMinutes({ deploymentCount: 85, threshold: 75 }), 15);
  assert.equal(batchBackoffMinutes({ deploymentCount: 90, threshold: 75 }), 30);
  assert.equal(batchBackoffMinutes({ deploymentCount: 95, threshold: 75 }), 60);
  assert.equal(batchBackoffMinutes({ deploymentCount: 97, threshold: 75 }), 120);
  assert.equal(batchBackoffMinutes({ deploymentCount: 98, threshold: 75 }), 240);
});

test("the next slot waits for both backoff and rolling capacity at 99", () => {
  const now = Date.parse("2026-08-31T12:00:00Z");
  const oldest = now - 23 * 60 * 60 * 1000;
  const deployments = Array.from({ length: 99 }, (_, index) => ({
    created: oldest + index * 10 * 60 * 1000,
  }));
  const result = nextBatchSlot({ deployments, threshold: 75, now });

  assert.equal(result.eligible, false);
  assert.equal(result.deploymentCount, 99);
  assert.equal(result.nextSlotAt, oldest + 24 * 60 * 60 * 1000);
  assert.match(result.reason, /rolling limit reserve/);
});

test("an overdue pressure slot is eligible", () => {
  const now = Date.parse("2026-08-31T12:00:00Z");
  const result = nextBatchSlot({
    deployments: [{ created: now - 6 * 60 * 1000 }],
    threshold: 75,
    now,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.backoffMinutes, 5);
});
