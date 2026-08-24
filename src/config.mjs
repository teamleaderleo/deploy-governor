import { readFile } from "node:fs/promises";

export async function loadConfig(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  validateConfig(raw);
  return {
    threshold: 50,
    windowHours: 24,
    ...raw,
    projects: raw.projects.map((project) => ({ branch: "main", ...project })),
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
  if (!Array.isArray(config.projects)) throw new Error("Config requires a projects array.");

  for (const project of config.projects) {
    for (const key of ["vercelProject", "vercelProjectId", "repo"]) {
      if (!project[key]) throw new Error(`Each project requires ${key}.`);
    }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(project.repo)) {
      throw new Error(`Invalid GitHub repository: ${project.repo}`);
    }
    if (project.branch !== undefined && (!project.branch || project.branch.includes("|"))) {
      throw new Error(`Invalid production branch: ${project.branch}`);
    }
  }

  if (config.threshold !== undefined && (!Number.isInteger(config.threshold) || config.threshold < 1 || config.threshold > 100)) {
    throw new Error("threshold must be an integer from 1 to 100.");
  }
  if (config.windowHours !== undefined && (!(config.windowHours > 0) || !Number.isFinite(config.windowHours))) {
    throw new Error("windowHours must be a positive number.");
  }
}
