/**
 * RÉSUMÉ — TYPES PARTAGÉS ET RACCOURCIS DE L'AGENT LIIX
 *
 * Ce fichier conserve les modes, risques et slash commands historiques. Les actions
 * détectées sont maintenant converties en outils structurés par aiPanel.ts; aucune
 * commande ou écriture n'est exécutée directement ici. Le runtime principal vit dans
 * aiAgentController.ts et aiToolExecutor.ts.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { findStm32Project } from "../qc1/projectDiscovery";
import { resolveInsideWorkspace } from "./aiSafety";

export type LiixAgentMode = "chat" | "agent" | "full";
export type LiixRisk = "LOW" | "MEDIUM" | "HIGH";
export type LiixPermissionDecision = "allowOnce" | "allowSession" | "alwaysAllow" | "deny";

export interface LiixAgentAction {
  kind: "readFile" | "writeFile" | "deleteFile" | "terminal" | "git" | "project" | "errors";
  command?: string;
  filePath?: string;
  content?: string;
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
  projectFiles: { core: boolean; drivers: boolean; cmake: boolean; packageJson: boolean };
  gitAvailable: boolean;
  provider: string;
  localMode: boolean;
}

export function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
}

export function resolveWorkspacePath(inputPath: string): string {
  const root = getWorkspaceRoot();
  const absolute = resolveInsideWorkspace(root, inputPath.trim());
  const realRoot = fs.realpathSync(root);
  let existing = absolute;
  while (!fs.existsSync(existing) && existing !== path.dirname(existing)) existing = path.dirname(existing);
  const reconstructed = path.resolve(fs.realpathSync(existing), path.relative(existing, absolute));
  resolveInsideWorkspace(realRoot, reconstructed);
  return absolute;
}

/** Les slash commands restent des raccourcis avancés, jamais le moteur principal. */
export function detectAgentAction(message: string): LiixAgentAction | undefined {
  const lines = message.trim().split(/\r?\n/);
  const first = lines[0] || "";
  if (/^\/read\s+/i.test(first)) return { kind: "readFile", filePath: first.replace(/^\/read\s+/i, "").trim() };
  if (/^\/(?:write|create)\s+/i.test(first)) return {
    kind: "writeFile",
    filePath: first.replace(/^\/(?:write|create)\s+/i, "").trim(),
    content: lines.slice(1).join("\n")
  };
  if (/^\/delete\s+/i.test(first)) return { kind: "deleteFile", filePath: first.replace(/^\/delete\s+/i, "").trim() };
  if (/^\/run\s+/i.test(first)) return { kind: "terminal", command: first.replace(/^\/run\s+/i, "").trim() };
  if (/^\/git\s+/i.test(first)) return { kind: "git", command: `git ${first.replace(/^\/git\s+/i, "").trim()}` };
  if (/^\/errors$/i.test(first)) return { kind: "errors" };
  if (/^\/project$/i.test(first)) return { kind: "project" };
  return undefined;
}

/** État léger affiché avant même qu'un modèle local soit disponible. */
export async function inspectRuntimeSnapshot(provider: string, localMode: boolean): Promise<LiixRuntimeSnapshot> {
  const workspace = getWorkspaceRoot();
  const stm32Dir = workspace ? findStm32Project(workspace)?.root || workspace : "";
  return {
    workspace: workspace || "--",
    projectFiles: workspace ? {
      core: fs.existsSync(path.join(stm32Dir, "Core")),
      drivers: fs.existsSync(path.join(stm32Dir, "Drivers")),
      cmake: fs.existsSync(path.join(stm32Dir, "CMakeLists.txt")),
      packageJson: fs.existsSync(path.join(workspace, "package.json"))
    } : { core: false, drivers: false, cmake: false, packageJson: false },
    gitAvailable: workspace ? await commandExists("git", ["--version"], workspace) : false,
    provider,
    localMode
  };
}

function commandExists(executable: string, args: string[], cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(executable, args, { cwd, env: process.env, windowsHide: true });
    const timer = setTimeout(() => child.kill("SIGTERM"), 3000);
    const finish = (available: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(available);
    };
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}
