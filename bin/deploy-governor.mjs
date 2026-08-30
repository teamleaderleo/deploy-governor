#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { findProject, loadConfig } from "../src/config.mjs";
import {
  dispatchCandidate,
  getLatestCommit,
  listDispatchCandidates,
} from "../src/github.mjs";
import { governBatch, governPush, pollProjects } from "../src/governor.mjs";
import { resolveProjects } from "../src/projects.mjs";
import { markdownSummary, noticeForResult } from "../src/summary.mjs";
import { VercelClient } from "../src/vercel.mjs";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (item === "--dry-run" || item === "--force") {
      args[item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true;
      continue;
    }
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = rest[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${item}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function numberArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, received: ${value}`);
  return parsed;
}

async function print(result) {
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdownSummary(result));
    console.log(`::notice title=Deploy governor::${noticeForResult(result)}`);
  }
  if (!process.env.GITHUB_OUTPUT) return;
  const outputs = {
    action: result.action ?? result.mode ?? "",
    "deployment-id": result.deploymentId ?? result.deployments?.[0]?.deploymentId ?? "",
    "deployment-count": result.deploymentCount ?? "",
  };
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
  await appendFile(process.env.GITHUB_OUTPUT, lines);
}

async function centralContext(args, token) {
  const config = await loadConfig(args.config ?? "projects.json");
  const client = new VercelClient({ token, teamSlug: config.teamSlug });
  const projects = await resolveProjects({ client, config });
  return { config, client, projects };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.VERCEL_TOKEN;

  if (args.command === "push") {
    const project = {
      vercelProject: args.vercelProject ?? process.env.VERCEL_PROJECT,
      vercelProjectId: args.vercelProjectId ?? process.env.VERCEL_PROJECT_ID,
      repo: args.repo ?? process.env.GITHUB_REPOSITORY,
      branch: args.branch ?? "main",
    };
    const teamSlug = args.teamSlug ?? process.env.VERCEL_TEAM_SLUG;
    const sha = args.sha ?? process.env.GITHUB_SHA;
    if (!project.vercelProject || !project.vercelProjectId || !project.repo || !sha) {
      throw new Error("push requires --vercel-project, --vercel-project-id, --repo, and --sha (or matching environment variables).");
    }

    const client = new VercelClient({ token, teamSlug });
    await print(
      await governPush({
        client,
        project,
        sha,
        threshold: numberArg(args.threshold, 75),
        windowHours: numberArg(args.windowHours, 24),
        dryRun: Boolean(args.dryRun),
      }),
    );
    return;
  }

  if (args.command === "candidate") {
    const { config, client, projects } = await centralContext(args, token);
    const repo = args.repo;
    const branch = args.branch ?? "main";
    const sha = args.sha;
    if (!repo || !sha) throw new Error("candidate requires --repo and --sha.");
    const project = findProject(projects, { repo, branch });
    if (!project) {
      await print({ action: "ignored", reason: "unregistered-project", repo, branch, sha });
      return;
    }
    await print(
      await governPush({
        client,
        project,
        sha,
        threshold: numberArg(args.threshold, config.threshold),
        windowHours: numberArg(args.windowHours, config.windowHours),
        dryRun: Boolean(args.dryRun),
      }),
    );
    return;
  }

  if (args.command === "poll" || args.command === "batch") {
    const { config, client, projects } = await centralContext(args, token);
    const governorRepository = args.governorRepo ?? process.env.GITHUB_REPOSITORY;
    if (!governorRepository) {
      throw new Error(`${args.command} requires --governor-repo or GITHUB_REPOSITORY.`);
    }
    const githubToken = process.env.GITHUB_TOKEN;
    const candidates = await listDispatchCandidates({
      repository: governorRepository,
      token: githubToken,
    });

    if (args.command === "poll") {
      await print(
        await pollProjects({
          client,
          projects,
          candidates,
          getLatestCommit,
          dispatchCandidate,
          governorRepository,
          githubToken,
          dryRun: Boolean(args.dryRun),
        }),
      );
      return;
    }

    await print(
      await governBatch({
        client,
        projects,
        candidates,
        threshold: numberArg(args.threshold, config.threshold),
        windowHours: numberArg(args.windowHours, config.windowHours),
        dryRun: Boolean(args.dryRun),
        force: Boolean(args.force),
      }),
    );
    return;
  }

  throw new Error("Usage: deploy-governor <push|candidate|poll|batch> [options]");
}

main().catch((error) => {
  console.error(error.stack ?? error.message ?? String(error));
  process.exitCode = 1;
});
