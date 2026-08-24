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

export function selectBatchProjects({ staleProjects, deploymentCount, threshold }) {
  const ordered = [...staleProjects].sort((a, b) => {
    const aTime = a.lastProductionAt ?? 0;
    const bTime = b.lastProductionAt ?? 0;
    return aTime - bTime || a.repo.localeCompare(b.repo);
  });

  if (ordered.length === 0) return [];

  if (deploymentCount >= threshold) {
    return ordered.slice(0, 1);
  }

  const immediateCapacity = Math.max(0, threshold - deploymentCount);
  return ordered.slice(0, immediateCapacity);
}
