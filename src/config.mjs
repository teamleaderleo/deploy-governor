import { readFile } from "node:fs/promises";

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function loadConfig(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  validateConfig(raw);
  return {
    threshold: 75,
    windowHours: 24,
    ...raw,
    projects: raw.projects.map((project) => ({ ...project })),
  };
}

export function findProject(projects, { repo, branch = "main" }) {
  const normalizedRepo = String(repo ?? "").toLowerCase();
  return projects.find(
    (project) => project.repo.toLowerCase() === normalizedRepo && project.branch === branch,
  ) ?? null;
}

export function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Config must be an object.");
  if (!config.teamSlug) throw new Error("Config requires teamSlug.");
  if (!Array.isArray(config.projects)) throw new Error("Config requires a projects array.");

  const seen = new Set();
  for (const project of config.projects) {
    if (!project?.repo || !repoPattern.test(project.repo)) {
      throw new Error(`Invalid GitHub repository: ${project?.repo}`);
    }
    const key = `${project.repo.toLowerCase()}|${project.vercelProject ?? ""}`;
    if (seen.has(key)) throw new Error(`Duplicate project enrollment: ${project.repo}`);
    seen.add(key);
    if (
      project.vercelProject !== undefined
      && (typeof project.vercelProject !== "string" || !project.vercelProject.trim())
    ) {
      throw new Error(`Invalid Vercel project selector for ${project.repo}.`);
    }
  }

  if (
    config.threshold !== undefined
    && (!Number.isInteger(config.threshold) || config.threshold < 1 || config.threshold > 100)
  ) {
    throw new Error("threshold must be an integer from 1 to 100.");
  }
  if (
    config.windowHours !== undefined
    && (!(config.windowHours > 0) || !Number.isFinite(config.windowHours))
  ) {
    throw new Error("windowHours must be a positive number.");
  }
}
