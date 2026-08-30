import assert from "node:assert/strict";
import test from "node:test";
import { markdownSummary, noticeForResult } from "../src/summary.mjs";

test("candidate summary exposes the decision, quota, and exact commit", () => {
  const result = {
    action: "batch-wait",
    reason: "75 deployments are inside the rolling window; batching is active.",
    repo: "teamleaderleo/scrapbook",
    branch: "main",
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    deploymentCount: 75,
    threshold: 75,
  };
  const summary = markdownSummary(result);
  assert.match(summary, /batch-wait/);
  assert.match(summary, /75 \/ 75/);
  assert.match(summary, /teamleaderleo\/scrapbook/);
  assert.match(summary, /`aaaaaaaaaa`/);
});

test("batch summary exposes the queue and next slot", () => {
  const result = {
    mode: "batch",
    deploymentCount: 82,
    threshold: 75,
    slotEligible: false,
    slotReason: "10-minute pressure backoff",
    nextSlotAt: "2026-08-31T12:10:00.000Z",
    staleProjects: [{
      repo: "teamleaderleo/scrapbook",
      vercelProject: "setzen",
      headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }],
    selected: [],
    deployments: [],
  };
  const summary = markdownSummary(result);
  assert.match(summary, /waiting for next slot/);
  assert.match(summary, /2026-08-31T12:10:00.000Z/);
  assert.match(summary, /Queue \(1\)/);
  assert.match(noticeForResult(result), /next slot/);
});
