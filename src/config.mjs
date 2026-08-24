import { readFile } from "node:fs/promises";

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ownerPattern = /^[A-Za-z0-9_.-]+$/;

export async function loadConfig(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  validateConfig(raw);
  return {
    threshold: 50,
    hardCeiling: 98,
    windowHours: 24,
    githubOwners: [],
    projects: [],
    ...raw,
    githubOwners: (raw.githubOwners ?? []).map((owner) => owner.toLowerCase()),
    projects: (raw.projects ?? []).map((project) => ({ branch: "main", ...project })),
  };
}

export function findProject(config, { repo, branch = "main" }) {
  const normalizedRepo = String(repo ?? "").toLowerCase();
  return config.projects.find(
    (project) => project.repo.toLowerCase() === normalizedRepo && project.branch === branch,
  ) ?? null;
}

export function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Config must be an object.");
  if (!config.teamSlug) throw new Error("Config requires teamSlug.");
  if (config.projects !== undefined && !Array.isArray(config.projects)) {
    throw new Error("projects must be an array when provided.");
  }
  if (config.githubOwners !== undefined && !Array.isArray(config.githubOwners)) {
    throw new Error("githubOwners must be an array when provided.");
  }

  for (const owner of config.githubOwners ?? []) {
    if (typeof owner !== "string" || !ownerPattern.test(owner)) {
      throw new Error(`Invalid GitHub owner: ${String(owner)}`);
    }
  }

  for (const project of config.projects ?? []) {
    for (const key of ["vercelProject", "vercelProjectId", "repo"]) {
      if (!project[key]) throw new Error(`Each project requires ${key}.`);
    }
    if (!repositoryPattern.test(project.repo)) {
      throw new Error(`Invalid GitHub repository: ${project.repo}`);
    }
    if (project.branch !== undefined && (!project.branch || project.branch.includes("|"))) {
      throw new Error(`Invalid production branch: ${project.branch}`);
    }
  }

  if (config.threshold !== undefined && (!Number.isInteger(config.threshold) || config.threshold < 1 || config.threshold > 100)) {
    throw new Error("threshold must be an integer from 1 to 100.");
  }
  if (config.hardCeiling !== undefined && (!Number.isInteger(config.hardCeiling) || config.hardCeiling < 1 || config.hardCeiling > 100)) {
    throw new Error("hardCeiling must be an integer from 1 to 100.");
  }
  if (
    config.threshold !== undefined
    && config.hardCeiling !== undefined
    && config.threshold >= config.hardCeiling
  ) {
    throw new Error("threshold must be lower than hardCeiling.");
  }
  if (config.windowHours !== undefined && (!(config.windowHours > 0) || !Number.isFinite(config.windowHours))) {
    throw new Error("windowHours must be a positive number.");
  }
}
