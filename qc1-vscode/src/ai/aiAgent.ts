import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { parseBuildLog, summarizeDiagnostics } from "./aiErrorParser";
import { findStm32Project } from "../qc1/projectDiscovery";

export type LiixAgentMode = "chat" | "agent" | "full";
export type LiixRisk = "LOW" | "MEDIUM" | "HIGH";

export type LiixPermissionDecision = "allowOnce" | "allowSession" | "alwaysAllow" | "deny";

export interface LiixAgentAction {
  kind: "readFile" | "writeFile" | "deleteFile" | "terminal" | "git" | "project" | "errors";
  command?: string;
  filePath?: string;
  content?: string;
}

export interface LiixAgentResult {
  ok: boolean;
  title: string;
  summary: string;
  details: string;
  action?: LiixAgentAction;
  risk?: LiixRisk;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  affectedFiles?: string[];
}

export interface LiixPermissionRequest {
  id: string;
  action: string;
  command?: string;
  files: string[];
  workspace: string;
  risk: LiixRisk;
  reason: string;
}

export interface LiixRuntimeSnapshot {
  workspace: string;
  projectFiles: {
    core: boolean;
    drivers: boolean;
    cmake: boolean;
    packageJson: boolean;
  };
  gitAvailable: boolean;
  provider: string;
  localMode: boolean;
}

export function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
}

function findStm32ProjectDir(workspace: string): string {
  return findStm32Project(workspace)?.root || workspace;
}

export function resolveWorkspacePath(inputPath: string): string {
  const workspace = getWorkspaceRoot();
  const normalized = inputPath.trim();

  if (!workspace) {
    throw new Error("Aucun workspace ouvert.");
  }

  const absolutePath = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(workspace, normalized);
  const relative = path.relative(workspace, absolutePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Chemin hors workspace bloque: ${absolutePath}`);
  }

  return absolutePath;
}

export function detectAgentAction(message: string): LiixAgentAction | undefined {
  const trimmed = message.trim();
  const lines = trimmed.split(/\r?\n/);
  const first = lines[0] || "";

  if (/^\/read\s+/i.test(first)) {
    return {
      kind: "readFile",
      filePath: first.replace(/^\/read\s+/i, "").trim()
    };
  }

  if (/^\/write\s+/i.test(first) || /^\/create\s+/i.test(first)) {
    return {
      kind: "writeFile",
      filePath: first.replace(/^\/(?:write|create)\s+/i, "").trim(),
      content: lines.slice(1).join("\n")
    };
  }

  if (/^\/delete\s+/i.test(first)) {
    return {
      kind: "deleteFile",
      filePath: first.replace(/^\/delete\s+/i, "").trim()
    };
  }

  if (/^\/run\s+/i.test(first)) {
    return {
      kind: "terminal",
      command: first.replace(/^\/run\s+/i, "").trim()
    };
  }

  if (/^\/git\s+/i.test(first)) {
    return {
      kind: "git",
      command: `git ${first.replace(/^\/git\s+/i, "").trim()}`
    };
  }

  if (/^\/errors$/i.test(first)) {
    return { kind: "errors" };
  }

  if (/^\/project$/i.test(first)) {
    return { kind: "project" };
  }

  return undefined;
}

export function getActionRisk(action: LiixAgentAction): LiixRisk {
  const command = (action.command || "").toLowerCase();

  if (action.kind === "deleteFile") {
    return "HIGH";
  }

  if (action.kind === "writeFile") {
    return "MEDIUM";
  }

  if (
    command.includes("reset --hard") ||
    command.includes("clean -fd") ||
    command.includes("rm -rf") ||
    command.includes("checkout ") ||
    command.includes("commit") ||
    command.includes("push") ||
    command.includes("rebase")
  ) {
    return "HIGH";
  }

  if (action.kind === "terminal" || action.kind === "git") {
    return command.startsWith("git status") || command.startsWith("git diff") ? "LOW" : "MEDIUM";
  }

  return "LOW";
}

export function requiresPermission(action: LiixAgentAction, mode: LiixAgentMode): boolean {
  if (mode === "chat") {
    return action.kind !== "readFile" && action.kind !== "project" && action.kind !== "errors";
  }

  if (mode === "agent") {
    return action.kind === "writeFile" ||
      action.kind === "deleteFile" ||
      action.kind === "terminal" ||
      (action.kind === "git" && !/^git\s+(status|diff|log|show)\b/i.test(action.command || ""));
  }

  return getActionRisk(action) !== "LOW";
}

export function createPermissionRequest(action: LiixAgentAction): LiixPermissionRequest {
  const workspace = getWorkspaceRoot() || "--";
  const risk = getActionRisk(action);
  const files = action.filePath ? [path.isAbsolute(action.filePath) ? action.filePath : path.join(workspace, action.filePath)] : [];

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action: action.kind,
    command: action.command,
    files,
    workspace,
    risk,
    reason: risk === "HIGH" ? "Action destructive ou persistante." : "Action qui modifie ou interroge le workspace."
  };
}

export async function runAgentAction(action: LiixAgentAction, mode: LiixAgentMode): Promise<LiixAgentResult> {
  if (mode === "chat" && !["readFile", "project", "errors"].includes(action.kind)) {
    return {
      ok: false,
      title: "Permission refusée",
      summary: "Le mode CHAT ne permet pas cette action.",
      details: "Passe en mode AGENT ou FULL pour autoriser les opérations projet.",
      action,
      risk: getActionRisk(action)
    };
  }

  switch (action.kind) {
    case "readFile":
      return readFileAction(action);
    case "writeFile":
      return writeFileAction(action);
    case "deleteFile":
      return deleteFileAction(action);
    case "terminal":
      return runCommandAction(action.command || "", action, mode);
    case "git":
      return runGitAction(action.command || "git status", action, mode);
    case "errors":
      return analyzeErrorsAction();
    case "project":
      return inspectProjectAction();
  }
}

export async function inspectRuntimeSnapshot(provider: string, localMode: boolean): Promise<LiixRuntimeSnapshot> {
  const workspace = getWorkspaceRoot();
  const stm32Dir = workspace ? findStm32ProjectDir(workspace) : "";
  const projectFiles = workspace
    ? {
        core: fs.existsSync(path.join(stm32Dir, "Core")),
        drivers: fs.existsSync(path.join(stm32Dir, "Drivers")),
        cmake: true,
        packageJson: fs.existsSync(path.join(workspace, "package.json"))
      }
    : {
        core: false,
        drivers: false,
        cmake: false,
        packageJson: false
      };

  const gitResult = workspace ? await execCommand("git --version", workspace, 3000) : undefined;

  return {
    workspace: workspace || "--",
    projectFiles,
    gitAvailable: Boolean(gitResult?.ok),
    provider,
    localMode
  };
}

async function readFileAction(action: LiixAgentAction): Promise<LiixAgentResult> {
  const filePath = resolveWorkspacePath(action.filePath || "");
  const content = await fs.promises.readFile(filePath, "utf8");

  return {
    ok: true,
    title: "Fichier lu",
    summary: path.relative(getWorkspaceRoot(), filePath),
    details: content.length > 20000 ? `${content.slice(0, 20000)}\n\n[contenu tronqué]` : content,
    action,
    risk: "LOW",
    affectedFiles: [filePath]
  };
}

async function writeFileAction(action: LiixAgentAction): Promise<LiixAgentResult> {
  const filePath = resolveWorkspacePath(action.filePath || "");
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, action.content || "", "utf8");

  return {
    ok: true,
    title: "Fichier écrit",
    summary: path.relative(getWorkspaceRoot(), filePath),
    details: `${Buffer.byteLength(action.content || "", "utf8")} octets écrits.`,
    action,
    risk: "MEDIUM",
    affectedFiles: [filePath]
  };
}

async function deleteFileAction(action: LiixAgentAction): Promise<LiixAgentResult> {
  const filePath = resolveWorkspacePath(action.filePath || "");
  await fs.promises.rm(filePath, { recursive: true, force: true });

  return {
    ok: true,
    title: "Fichier supprimé",
    summary: path.relative(getWorkspaceRoot(), filePath),
    details: "Suppression terminée.",
    action,
    risk: "HIGH",
    affectedFiles: [filePath]
  };
}

async function runCommandAction(command: string, action: LiixAgentAction, mode: LiixAgentMode): Promise<LiixAgentResult> {
  if (mode !== "full" && !isLimitedTerminalCommand(command)) {
    return {
      ok: false,
      title: "Commande bloquée",
      summary: "Le mode AGENT autorise seulement les commandes terminal limitées.",
      details: "Utilise FULL pour les scripts arbitraires.",
      action,
      risk: getActionRisk(action)
    };
  }

  const workspace = getWorkspaceRoot();
  const cwd = workspace ? findStm32ProjectDir(workspace) : workspace;

  return commandResultToAgentResult(await execCommand(command, cwd, 120000), action, "Commande terminal");
}

async function runGitAction(command: string, action: LiixAgentAction, mode: LiixAgentMode): Promise<LiixAgentResult> {
  if (mode !== "full" && !/^git\s+(status|diff|log|show)\b/i.test(command)) {
    return {
      ok: false,
      title: "Commande git bloquée",
      summary: "Le mode AGENT autorise seulement git status/diff/log/show.",
      details: "Passe en FULL pour git add, commit, checkout, reset ou rebase.",
      action,
      risk: getActionRisk(action)
    };
  }

  return commandResultToAgentResult(await execCommand(command, getWorkspaceRoot(), 120000), action, "Commande git");
}

async function analyzeErrorsAction(): Promise<LiixAgentResult> {
  const workspace = getWorkspaceRoot();
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const diagnosticSummary = summarizeDiagnostics(activeUri);
  const logPath = workspace ? path.join(workspace, ".qc1_last_build.log") : "";
  const buildLog = logPath && fs.existsSync(logPath)
    ? parseBuildLog(await fs.promises.readFile(logPath, "utf8"))
    : undefined;
  const diagnostics = [
    ...(buildLog?.diagnostics || []),
    ...diagnosticSummary.diagnostics
  ].slice(0, 40);

  return {
    ok: true,
    title: "Erreurs analysées",
    summary: `${(buildLog?.errors || 0) + diagnosticSummary.errors} erreur(s), ${(buildLog?.warnings || 0) + diagnosticSummary.warnings} warning(s)`,
    details: diagnostics.length ? diagnostics.join("\n") : "Aucun diagnostic détecté.",
    action: { kind: "errors" },
    risk: "LOW"
  };
}

async function inspectProjectAction(): Promise<LiixAgentResult> {
  const workspace = getWorkspaceRoot();

  if (!workspace) {
    return {
      ok: false,
      title: "Workspace absent",
      summary: "Aucun workspace ouvert.",
      details: "--",
      action: { kind: "project" },
      risk: "LOW"
    };
  }

  const entries = await fs.promises.readdir(workspace);
  const stm32Dir = findStm32ProjectDir(workspace);
  const signals = [
    `Workspace: ${workspace}`,
    `STM32 dir: ${stm32Dir}`,
    "Projet CMake QC1: intégré à l'extension",
    `package.json: ${fs.existsSync(path.join(workspace, "package.json")) ? "oui" : "non"}`,
    `Core/: ${fs.existsSync(path.join(stm32Dir, "Core")) ? "oui" : "non"}`,
    `Drivers/: ${fs.existsSync(path.join(stm32Dir, "Drivers")) ? "oui" : "non"}`,
    "",
    "Racine:",
    entries.slice(0, 80).join("\n")
  ];

  return {
    ok: true,
    title: "Projet inspecté",
    summary: workspace,
    details: signals.join("\n"),
    action: { kind: "project" },
    risk: "LOW"
  };
}

function isLimitedTerminalCommand(command: string): boolean {
  return /^(npm\s+(run|test|install)|cmake\b|ls\b|pwd\b|rg\b|grep\b|cat\b|sed\b|bash\s+-n\b)/i.test(command.trim());
}

function execCommand(command: string, cwd: string, timeout: number): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  return new Promise((resolve) => {
    exec(command, {
      cwd,
      timeout,
      encoding: "utf8",
      env: process.env
    }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === "number"
        ? (error as { code: number }).code
        : error ? 1 : 0;
      resolve({
        ok: !error,
        stdout: stdout || "",
        stderr: stderr || "",
        exitCode: code
      });
    });
  });
}

function commandResultToAgentResult(result: {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}, action: LiixAgentAction, title: string): LiixAgentResult {
  return {
    ok: result.ok,
    title,
    summary: result.ok ? "Commande terminée." : "Commande échouée.",
    details: [
      `Commande: ${action.command}`,
      `Exit: ${result.exitCode ?? "--"}`,
      "",
      "--- stdout ---",
      result.stdout.trim() || "--",
      "",
      "--- stderr ---",
      result.stderr.trim() || "--"
    ].join("\n"),
    action,
    risk: getActionRisk(action),
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}
