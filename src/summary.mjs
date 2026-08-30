function shortSha(sha) {
  return sha ? String(sha).slice(0, 10) : "—";
}

function markdownCell(value) {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function quotaLabel(result) {
  if (result.deploymentCount === null || result.deploymentCount === undefined) return "Already current";
  return `${result.deploymentCount} / ${result.threshold ?? "?"} immediate threshold`;
}

function decisionLabel(result) {
  if (result.action) return result.action;
  if (result.deployments?.length) return result.dryRun ? "would deploy" : "deployed";
  if (!result.staleProjects?.length) return "queue empty";
  if (!result.slotEligible) return "waiting for next slot";
  return result.mode ?? "evaluated";
}

export function noticeForResult(result) {
  const parts = [decisionLabel(result), quotaLabel(result)];
  if (result.nextSlotAt && !result.slotEligible) parts.push(`next slot ${result.nextSlotAt}`);
  if (result.deployments?.[0]?.repo) parts.push(result.deployments[0].repo);
  else if (result.repo) parts.push(`${result.repo}@${shortSha(result.sha)}`);
  return parts.join(" · ");
}

export function markdownSummary(result) {
  const lines = [
    "# Deploy governor",
    "",
    `**Decision:** ${decisionLabel(result)}`,
    "",
    `**Quota:** ${quotaLabel(result)}`,
  ];

  if (result.reason) lines.push("", `**Why:** ${result.reason}`);
  if (result.slotReason) lines.push("", `**Slot policy:** ${result.slotReason}`);
  if (result.nextSlotAt) {
    lines.push("", `**Next computed slot:** ${result.slotEligible ? "now" : result.nextSlotAt}`);
  }
  if (result.forced) lines.push("", "**Override:** manual force was used");

  if (result.repo) {
    lines.push(
      "",
      "## Candidate",
      "",
      "| Repository | Branch | Commit |",
      "| --- | --- | --- |",
      `| ${markdownCell(result.repo)} | ${markdownCell(result.branch)} | \`${shortSha(result.sha)}\` |`,
    );
  }

  if (result.staleProjects) {
    lines.push("", `## Queue (${result.staleProjects.length})`);
    if (result.staleProjects.length) {
      lines.push(
        "",
        "| Repository | Project | Commit | Selected |",
        "| --- | --- | --- | --- |",
      );
      const selected = new Set(result.selected?.map((item) => `${item.repo}|${item.headSha}`));
      for (const project of result.staleProjects) {
        lines.push(
          `| ${markdownCell(project.repo)} | ${markdownCell(project.vercelProject)} | \`${shortSha(project.headSha)}\` | ${selected.has(`${project.repo}|${project.headSha}`) ? "yes" : "no"} |`,
        );
      }
    } else {
      lines.push("", "No pending production candidates.");
    }
  }

  if (result.deployments?.length) {
    lines.push("", "## Deployment", "");
    for (const deployment of result.deployments) {
      const url = deployment.deploymentUrl
        ? `https://${String(deployment.deploymentUrl).replace(/^https?:\/\//, "")}`
        : null;
      lines.push(
        `- ${deployment.dryRun ? "Would deploy" : "Deployed"} ${deployment.repo} at \`${shortSha(deployment.sha)}\`${url ? ` — [open deployment](${url})` : ""}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
