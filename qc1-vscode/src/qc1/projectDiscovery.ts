import * as fs from "fs";
import * as path from "path";

export type Qc1ProjectLayout = "native-cmake" | "cubemx" | "bare-metal" | "unknown";

export interface Qc1ProjectInspection {
  root: string;
  layout: Qc1ProjectLayout;
  nativeCmakePath: string;
  corePath: string;
  driversPath: string;
  srcPath: string;
  incPath: string;
  startupPath: string;
  linkerScriptPath: string;
  projectName: string;
  score: number;
}

const ignoredDirectories = new Set([
  ".git",
  ".vscode",
  "backups",
  "build",
  "dist",
  "node_modules",
  "out",
  "__pycache__"
]);

function exists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

function collectProjectFiles(root: string, pattern: RegExp, maxDepth = 8): string[] {
  const matches: string[] = [];

  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isFile() && pattern.test(entry.name)) {
        matches.push(path.join(current, entry.name));
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) continue;
      walk(path.join(current, entry.name), depth + 1);
    }
  }

  walk(root, 0);
  return matches;
}

function chooseLinkerScript(root: string, candidates: string[]): string {
  return [...candidates].sort((left, right) => {
    const score = (candidate: string): number => {
      const name = path.basename(candidate).toLowerCase();
      const relative = path.relative(root, candidate);
      let value = path.dirname(relative) === "." ? 100 : 0;
      if (name.includes("stm32f103")) value += 40;
      if (name.includes("flash")) value += 20;
      return value;
    };

    return score(right) - score(left) || left.localeCompare(right);
  })[0] || "";
}

export function readCmakeProjectName(cmakePath: string): string {
  if (!cmakePath || !exists(cmakePath)) return "firmware";

  try {
    const source = fs.readFileSync(cmakePath, "utf8");
    const match = source.match(/\bproject\s*\(\s*([^\s)]+)/i);
    return match?.[1]?.replace(/["']/g, "") || "firmware";
  } catch {
    return "firmware";
  }
}

export function inspectStm32Project(root: string): Qc1ProjectInspection {
  if (!root) {
    return {
      root: "",
      layout: "unknown",
      nativeCmakePath: "",
      corePath: "",
      driversPath: "",
      srcPath: "",
      incPath: "",
      startupPath: "",
      linkerScriptPath: "",
      projectName: "firmware",
      score: 0
    };
  }

  const nativeCmakePath = path.join(root, "CMakeLists.txt");
  const corePath = path.join(root, "Core");
  const driversPath = path.join(root, "Drivers");
  const srcPath = exists(path.join(root, "Src")) ? path.join(root, "Src") : path.join(corePath, "Src");
  const incPath = exists(path.join(root, "Inc")) ? path.join(root, "Inc") : path.join(corePath, "Inc");
  const startupPath = collectProjectFiles(root, /^startup_stm32f103.*\.[sS]$/i)[0] || "";
  const linkerScriptPath = chooseLinkerScript(root, collectProjectFiles(root, /\.ld$/i));

  const hasNativeCmake = exists(nativeCmakePath);
  const hasCore = exists(corePath);
  const hasDrivers = exists(driversPath);
  const hasSources = exists(srcPath);
  const hasStartup = Boolean(startupPath);
  const hasLinker = Boolean(linkerScriptPath);
  const layout: Qc1ProjectLayout = hasNativeCmake
    ? "native-cmake"
    : hasCore
      ? "cubemx"
      : hasSources
        ? "bare-metal"
        : "unknown";
  const score =
    (hasNativeCmake ? 100 : 0) +
    (hasSources ? 40 : 0) +
    (hasStartup ? 30 : 0) +
    (hasLinker ? 20 : 0) +
    (hasCore ? 10 : 0) +
    (hasDrivers ? 5 : 0);

  return {
    root,
    layout,
    nativeCmakePath: hasNativeCmake ? nativeCmakePath : "",
    corePath,
    driversPath,
    srcPath,
    incPath,
    startupPath,
    linkerScriptPath,
    projectName: readCmakeProjectName(hasNativeCmake ? nativeCmakePath : ""),
    score
  };
}

export function isUsableStm32Project(inspection: Qc1ProjectInspection): boolean {
  return inspection.layout !== "unknown" &&
    Boolean(inspection.startupPath) &&
    Boolean(inspection.linkerScriptPath) &&
    exists(inspection.srcPath);
}

export function findStm32Project(root: string, maxDepth = 8): Qc1ProjectInspection | null {
  const candidates: Qc1ProjectInspection[] = [];

  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;

    const hasProjectMarker = exists(path.join(current, "CMakeLists.txt")) ||
      exists(path.join(current, "Src")) ||
      exists(path.join(current, "Core"));
    if (hasProjectMarker) {
      const inspection = inspectStm32Project(current);
      if (isUsableStm32Project(inspection)) {
        candidates.push(inspection);
        return;
      }
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) continue;
      walk(path.join(current, entry.name), depth + 1);
    }
  }

  walk(root, 0);
  return candidates.sort((left, right) => {
    const leftDepth = path.relative(root, left.root).split(path.sep).filter(Boolean).length;
    const rightDepth = path.relative(root, right.root).split(path.sep).filter(Boolean).length;
    return right.score - left.score || leftDepth - rightDepth || left.root.localeCompare(right.root);
  })[0] || null;
}

export function resolveConfiguredProjectPath(configuredPath: string, workspaceRoot: string): string {
  if (!configuredPath) return workspaceRoot;
  return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(workspaceRoot, configuredPath);
}
