export function decidePush({ deploymentCount, threshold, alreadyDeployed }) {
  if (alreadyDeployed) {
    return { action: "already-current", reason: "This commit already has a production deployment." };
  }

  if (deploymentCount < threshold) {
    return {
      action: "deploy-now",
      reason: `${deploymentCount}/${threshold} deployments are inside the rolling window.`,
    };
  }

  return {
    action: "batch-wait",
    reason: `${deploymentCount} deployments are inside the rolling window; batching is active.`,
  };
}

export function batchBackoffMinutes({ deploymentCount, threshold }) {
  const pressure = Math.max(0, deploymentCount - threshold);
  if (pressure < 5) return 5;
  if (pressure < 10) return 10;
  if (pressure < 15) return 15;
  if (pressure < 20) return 30;
  if (pressure < 22) return 60;
  if (pressure < 23) return 120;
  return 240;
}

export function nextBatchSlot({
  deployments,
  threshold,
  windowHours = 24,
  hardLimit = 99,
  now = Date.now(),
}) {
  const windowMs = windowHours * 60 * 60 * 1000;
  const createdTimes = deployments
    .map((deployment) => Number(deployment?.created ?? deployment?.createdAt))
    .filter((createdAt) => Number.isFinite(createdAt) && createdAt >= now - windowMs)
    .sort((left, right) => left - right);
  const deploymentCount = createdTimes.length;
  const backoffMinutes = batchBackoffMinutes({ deploymentCount, threshold });
  const latestAt = createdTimes.at(-1) ?? null;
  let nextSlotAt = latestAt === null ? now : latestAt + backoffMinutes * 60 * 1000;
  let reason = `${backoffMinutes}-minute pressure backoff`;

  if (deploymentCount >= hardLimit) {
    const expirationsNeeded = deploymentCount - hardLimit + 1;
    const capacityAt = createdTimes[expirationsNeeded - 1] + windowMs;
    nextSlotAt = Math.max(nextSlotAt, capacityAt);
    reason = `rolling limit reserve; ${expirationsNeeded} deployment${expirationsNeeded === 1 ? "" : "s"} must expire`;
  }

  return {
    deploymentCount,
    backoffMinutes,
    nextSlotAt,
    eligible: now >= nextSlotAt,
    reason,
    hardLimit,
  };
}

export function selectBatchProjects({ staleProjects }) {
  const ordered = [...staleProjects].sort((a, b) => {
    const aTime = a.lastProductionAt ?? 0;
    const bTime = b.lastProductionAt ?? 0;
    return aTime - bTime || a.repo.localeCompare(b.repo);
  });

  return ordered.slice(0, 1);
}
