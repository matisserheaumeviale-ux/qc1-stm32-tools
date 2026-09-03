/**
 * RÉSUMÉ — EXÉCUTEUR SÉCURISÉ DES OUTILS LIIX
 *
 * Toutes les demandes du modèle passent ici. Les chemins sont enfermés dans le
 * workspace, les arguments sont validés, les sorties sont limitées et les processus
 * utilisent spawn() pour diffuser stdout/stderr et répondre à AbortController.
 * Les éditions créent un checkpoint indépendant de Git pour permettre Undo.
 */

import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { findStm32Project } from "../qc1/projectDiscovery";
import { LiixToolCall } from "./aiProtocol";
import { assertSafeCommand, resolveInsideWorkspace } from "./aiSafety";
import { getToolMetadata } from "./aiTools";

const MAX_OUTPUT_CHARS = 40_000;
const MAX_FILE_CHARS = 30_000;
const DEFAULT_PROCESS_TIMEOUT = 120_000;
const IGNORED_DIRS = new Set([".git", "node_modules", "out", "dist", ".cache", "build"]);

export type LiixToolEvent = {
  toolCallId: string;
  name: string;
  state: "running" | "success" | "error";
  summary: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number;
  affectedFiles?: string[];
};

export interface LiixToolExecutionResult {
  ok: boolean;
  name: string;
  summary: string;
  details: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs: number;
  affectedFiles?: string[];
  additions?: number;
  deletions?: number;
}

type Checkpoint = {
  filePath: string;
  existed: boolean;
  content: Uint8Array;
};

export class LiixToolExecutor implements vscode.Disposable {
  private activeProcess?: ChildProcess;
  private activeToolCallId = "";
  private lastCheckpoint?: Checkpoint;
  private lastChangedFiles: string[] = [];

  constructor(private readonly onEvent: (event: LiixToolEvent) => void) {}

  async execute(call: LiixToolCall, signal: AbortSignal): Promise<LiixToolExecutionResult> {
    const startedAt = Date.now();
    const metadata = getToolMetadata(call.name);
    if (!metadata) return this.failure(call.name, `Outil inconnu: ${call.name}`, startedAt);
    if (signal.aborted) throw abortError();

    this.activeToolCallId = call.id;
    this.onEvent({ toolCallId: call.id, name: call.name, state: "running", summary: describeCall(call) });
    try {
      const result = await this.dispatch(call, signal, startedAt);
      this.onEvent({
        toolCallId: call.id,
        name: call.name,
        state: result.ok ? "success" : "error",
        summary: result.summary,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        affectedFiles: result.affectedFiles
      });
      return result;
    } catch (error) {
      const result = this.failure(call.name, error instanceof Error ? error.message : String(error), startedAt);
      this.onEvent({ toolCallId: call.id, name: call.name, state: "error", summary: result.summary, durationMs: result.durationMs });
      return result;
    } finally {
      this.activeToolCallId = "";
    }
  }

  cancel(): void {
    if (!this.activeProcess || this.activeProcess.killed) return;
    this.activeProcess.kill("SIGTERM");
    const processToStop = this.activeProcess;
    setTimeout(() => {
      if (processToStop.exitCode === null && processToStop.signalCode === null) processToStop.kill("SIGKILL");
    }, 1500);
  }

  async undoLastEdit(): Promise<string> {
    const checkpoint = this.lastCheckpoint;
    if (!checkpoint) return "Aucune modification Liix à annuler.";
    const uri = vscode.Uri.file(checkpoint.filePath);
    if (checkpoint.existed) {
      await vscode.workspace.fs.writeFile(uri, checkpoint.content);
    } else {
      try {
        await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
      } catch {
        // Le fichier a peut-être déjà été supprimé manuellement.
      }
    }
    this.lastCheckpoint = undefined;
    this.lastChangedFiles = [];
    return `Modification Liix annulée: ${this.relative(checkpoint.filePath)}`;
  }

  async openLastDiff(): Promise<void> {
    const filePath = this.lastChangedFiles[0];
    if (!filePath) throw new Error("Aucun diff Liix récent à afficher.");
    await vscode.commands.executeCommand("git.openChange", vscode.Uri.file(filePath));
  }

  dispose(): void {
    this.cancel();
  }

  private async dispatch(call: LiixToolCall, signal: AbortSignal, startedAt: number): Promise<LiixToolExecutionResult> {
    switch (call.name) {
      case "read_file": return this.readFile(call.arguments, startedAt);
      case "list_directory": return this.listDirectory(call.arguments, startedAt);
      case "search_files": return this.searchFiles(call.arguments, startedAt);
      case "search_text": return this.searchText(call.arguments, signal, startedAt);
      case "get_active_file": return this.getActiveFile(startedAt);
      case "get_selection": return this.getSelection(startedAt);
      case "get_diagnostics": return this.getDiagnostics(call.arguments, startedAt);
      case "inspect_project": return this.inspectProject(startedAt);
      case "write_file": return this.writeFile(call.arguments, false, startedAt);
      case "create_file": return this.writeFile(call.arguments, true, startedAt);
      case "apply_patch": return this.applyPatch(call.arguments, startedAt);
      case "delete_file": return this.deleteFile(call.arguments, startedAt);
      case "run_terminal": return this.runTerminal(call.arguments, signal, startedAt);
      case "build_project": return this.buildProject(call.arguments, signal, startedAt);
      case "run_tests": return this.runTests(call.arguments, signal, startedAt);
      case "git_status": return this.runGit(["status", "--short", "--branch"], signal, startedAt, "État Git lu");
      case "git_diff": return this.gitDiff(call.arguments, signal, startedAt);
      case "git_log": return this.gitLog(call.arguments, signal, startedAt);
      case "git_show": return this.gitShow(call.arguments, signal, startedAt);
      default: return this.failure(call.name, `Outil non implémenté: ${call.name}`, startedAt);
    }
  }

  private async readFile(args: Record<string, unknown>, startedAt: number): Promise<LiixToolExecutionResult> {
    const filePath = this.resolvePath(requiredString(args, "path"));
    const text = await fs.promises.readFile(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    const startLine = clampInteger(args.startLine, 1, Math.max(1, lines.length), 1);
    const endLine = clampInteger(args.endLine, startLine, Math.max(startLine, lines.length), Math.min(lines.length, startLine + 299));
    const selected = lines.slice(startLine - 1, endLine).join("\n");
    const truncated = selected.length > MAX_FILE_CHARS;
    const content = truncated ? `${selected.slice(0, MAX_FILE_CHARS)}\n[Contenu tronqué]` : selected;
    return this.success("read_file", `${this.relative(filePath)} · lignes ${startLine}-${endLine}/${lines.length}`, content, startedAt, { affectedFiles: [filePath] });
  }

  private async listDirectory(args: Record<string, unknown>, startedAt: number): Promise<LiixToolExecutionResult> {
    const directory = this.resolvePath(optionalString(args, "path") || ".");
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    const details = entries
      .filter((entry) => !IGNORED_DIRS.has(entry.name))
      .slice(0, 300)
      .map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`)
      .join("\n");
    return this.success("list_directory", `${entries.length} entrée(s) dans ${this.relative(directory)}`, details || "Dossier vide.", startedAt);
  }

  private async searchFiles(args: Record<string, unknown>, startedAt: number): Promise<LiixToolExecutionResult> {
    const pattern = requiredString(args, "pattern");
    const base = optionalString(args, "path");
    if (base) this.resolvePath(base);
    const include = base ? new vscode.RelativePattern(this.resolvePath(base), pattern) : pattern;
    const uris = await vscode.workspace.findFiles(include, "**/{.git,node_modules,out,dist,build}/**", 200);
    const safeUris = uris.filter((uri) => {
      try { this.resolvePath(uri.fsPath); return true; } catch { return false; }
    });
    const matches = safeUris.map((uri) => this.relative(uri.fsPath));
    return this.success("search_files", `${matches.length} fichier(s) trouvé(s)`, matches.join("\n") || "Aucun fichier trouvé.", startedAt, { affectedFiles: safeUris.map((uri) => uri.fsPath) });
  }

  private async searchText(args: Record<string, unknown>, signal: AbortSignal, startedAt: number): Promise<LiixToolExecutionResult> {
    const query = requiredString(args, "query");
    const cwd = this.resolvePath(optionalString(args, "path") || ".");
    const maxResults = clampInteger(args.maxResults, 1, 200, 80);
    const commandArgs = ["--line-number", "--column", "--color", "never", "--max-count", String(maxResults), "--glob", "!{.git,node_modules,out,dist,build}/**"];
    const glob = optionalString(args, "glob");
    if (glob) commandArgs.push("--glob", glob);
    commandArgs.push("--", query, ".");
    const process = await this.runProcess("rg", commandArgs, cwd, signal, DEFAULT_PROCESS_TIMEOUT, false);
    if (process.spawnError && /ENOENT/i.test(process.spawnError)) return this.searchTextFallback(query, cwd, maxResults, startedAt);
    if (process.exitCode === 1 && !process.stderr.trim()) process.ok = true;
    return this.processResult("search_text", process, startedAt, process.ok ? "Recherche terminée" : "Recherche sans résultat ou échouée");
  }

  private async searchTextFallback(query: string, cwd: string, maxResults: number, startedAt: number): Promise<LiixToolExecutionResult> {
    const matches: string[] = [];
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 8 || matches.length >= maxResults) return;
      for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
        if (matches.length >= maxResults) break;
        if (IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
        const itemPath = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(itemPath, depth + 1);
        else {
          try {
            const text = await fs.promises.readFile(itemPath, "utf8");
            text.split(/\r?\n/).forEach((line, index) => {
              if (matches.length < maxResults && line.includes(query)) matches.push(`${this.relative(itemPath)}:${index + 1}:${line.slice(0, 300)}`);
            });
          } catch { /* fichier binaire ou illisible */ }
        }
      }
    };
    await walk(cwd, 0);
    return this.success("search_text", `${matches.length} résultat(s)`, matches.join("\n") || "Aucun résultat.", startedAt);
  }

  private async getActiveFile(startedAt: number): Promise<LiixToolExecutionResult> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return this.failure("get_active_file", "Aucun fichier actif.", startedAt);
    const filePath = this.resolvePath(editor.document.uri.fsPath);
    const text = editor.document.getText();
    return this.success("get_active_file", this.relative(filePath), text.slice(0, MAX_FILE_CHARS) + (text.length > MAX_FILE_CHARS ? "\n[Contenu tronqué]" : ""), startedAt, { affectedFiles: [filePath] });
  }

  private async getSelection(startedAt: number): Promise<LiixToolExecutionResult> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) return this.failure("get_selection", "Aucune sélection active.", startedAt);
    const filePath = this.resolvePath(editor.document.uri.fsPath);
    const text = editor.document.getText(editor.selection);
    return this.success("get_selection", `${this.relative(filePath)} · ${text.split(/\r?\n/).length} ligne(s)`, text.slice(0, MAX_FILE_CHARS), startedAt, { affectedFiles: [filePath] });
  }

  private async getDiagnostics(args: Record<string, unknown>, startedAt: number): Promise<LiixToolExecutionResult> {
    const requested = optionalString(args, "path");
    const entries = requested
      ? [[vscode.Uri.file(this.resolvePath(requested)), vscode.languages.getDiagnostics(vscode.Uri.file(this.resolvePath(requested)))]] as [vscode.Uri, vscode.Diagnostic[]][]
      : vscode.languages.getDiagnostics();
    const lines: string[] = [];
    for (const [uri, diagnostics] of entries) {
      if (!this.isInsideWorkspace(uri.fsPath)) continue;
      for (const diagnostic of diagnostics.slice(0, 100)) {
        const severity = vscode.DiagnosticSeverity[diagnostic.severity] || "Info";
        lines.push(`${this.relative(uri.fsPath)}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1} ${severity}: ${diagnostic.message}`);
      }
    }
    return this.success("get_diagnostics", `${lines.length} diagnostic(s)`, lines.join("\n") || "Aucun diagnostic VS Code.", startedAt);
  }

  private async inspectProject(startedAt: number): Promise<LiixToolExecutionResult> {
    const workspace = this.workspaceRoot();
    const stm32 = findStm32Project(workspace);
    const important = ["package.json", "CMakeLists.txt", "README.md", "tsconfig.json", ".vscode/settings.json"];
    const tree: string[] = [];
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 3 || tree.length >= 220) return;
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (tree.length >= 220 || IGNORED_DIRS.has(entry.name)) continue;
        const item = path.join(directory, entry.name);
        tree.push(`${"  ".repeat(depth)}${entry.isDirectory() ? "▸" : "•"} ${entry.name}`);
        if (entry.isDirectory()) await walk(item, depth + 1);
      }
    };
    await walk(workspace, 0);
    const details = [
      `Workspace: ${workspace}`,
      `Projet STM32: ${stm32?.root || "non détecté"}`,
      `Fichiers importants: ${important.filter((name) => fs.existsSync(path.join(workspace, name))).join(", ") || "aucun"}`,
      "",
      ...tree
    ].join("\n");
    return this.success("inspect_project", stm32 ? `Projet STM32 détecté: ${path.basename(stm32.root)}` : "Workspace inspecté", details, startedAt);
  }

  private async writeFile(args: Record<string, unknown>, createOnly: boolean, startedAt: number): Promise<LiixToolExecutionResult> {
    const filePath = this.resolvePath(requiredString(args, "path"));
    const content = requiredString(args, "content", true);
    const exists = fs.existsSync(filePath);
    if (createOnly && exists) throw new Error("create_file refuse d'écraser un fichier existant; utilise write_file ou apply_patch.");
    const oldContent = exists ? await fs.promises.readFile(filePath) : new Uint8Array();
    await this.ensureDocumentCanBeWritten(filePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(content, "utf8"));
    this.recordCheckpoint(filePath, exists, oldContent);
    const stats = diffStats(exists ? Buffer.from(oldContent).toString("utf8") : "", content);
    return this.success(createOnly ? "create_file" : "write_file", `${this.relative(filePath)} modifié`, `${stats.additions} ajout(s), ${stats.deletions} suppression(s)`, startedAt, { affectedFiles: [filePath], ...stats });
  }

  private async applyPatch(args: Record<string, unknown>, startedAt: number): Promise<LiixToolExecutionResult> {
    const filePath = this.resolvePath(requiredString(args, "path"));
    const oldText = requiredString(args, "oldText", true);
    const newText = requiredString(args, "newText", true);
    if (!oldText) throw new Error("oldText ne peut pas être vide.");
    const content = await fs.promises.readFile(filePath, "utf8");
    const occurrences = content.split(oldText).length - 1;
    if (occurrences === 0) throw new Error("Le texte à remplacer est introuvable; relis le fichier avant de modifier.");
    const replaceAll = args.replaceAll === true;
    if (occurrences > 1 && !replaceAll) throw new Error(`${occurrences} correspondances trouvées; fournis un oldText plus précis ou replaceAll=true.`);
    const updated = replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, newText);
    await this.ensureDocumentCanBeWritten(filePath);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(updated, "utf8"));
    this.recordCheckpoint(filePath, true, Buffer.from(content, "utf8"));
    const stats = diffStats(content, updated);
    return this.success("apply_patch", `${this.relative(filePath)} modifié`, `${stats.additions} ajout(s), ${stats.deletions} suppression(s)`, startedAt, { affectedFiles: [filePath], ...stats });
  }

  private async deleteFile(args: Record<string, unknown>, startedAt: number): Promise<LiixToolExecutionResult> {
    const filePath = this.resolvePath(requiredString(args, "path"));
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    if (stat.type === vscode.FileType.Directory) throw new Error("delete_file refuse les dossiers; supprime uniquement un fichier explicite.");
    const content = await fs.promises.readFile(filePath);
    await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { recursive: false, useTrash: true });
    this.recordCheckpoint(filePath, true, content);
    return this.success("delete_file", `${this.relative(filePath)} déplacé vers la corbeille`, "Suppression récupérable.", startedAt, { affectedFiles: [filePath] });
  }

  private async runTerminal(args: Record<string, unknown>, signal: AbortSignal, startedAt: number): Promise<LiixToolExecutionResult> {
    const command = requiredString(args, "command");
    assertSafeCommand(command);
    const cwd = this.resolvePath(optionalString(args, "cwd") || ".");
    const shell = os.platform() === "win32" ? (process.env.ComSpec || "cmd.exe") : (process.env.SHELL || "/bin/zsh");
    const shellArgs = os.platform() === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
    const result = await this.runProcess(shell, shellArgs, cwd, signal, DEFAULT_PROCESS_TIMEOUT, true);
    return this.processResult("run_terminal", result, startedAt, result.ok ? "Commande terminée" : "Commande échouée");
  }

  private async buildProject(args: Record<string, unknown>, signal: AbortSignal, startedAt: number): Promise<LiixToolExecutionResult> {
    const explicit = optionalString(args, "command");
    if (explicit) return this.runTerminal({ command: explicit }, signal, startedAt);
    const workspace = this.workspaceRoot();
    const project = findStm32Project(workspace)?.root || workspace;
    let command: string;
    if (fs.existsSync(path.join(project, "CMakeLists.txt"))) {
      const buildDirectory = fs.existsSync(path.join(project, "build", "qc1")) ? "build/qc1" : "build/qc1";
      command = fs.existsSync(path.join(project, buildDirectory, "CMakeCache.txt"))
        ? `cmake --build ${quoteShell(buildDirectory)} --parallel`
        : `cmake -S . -B ${quoteShell(buildDirectory)} -G Ninja && cmake --build ${quoteShell(buildDirectory)} --parallel`;
    } else if (fs.existsSync(path.join(project, "package.json"))) command = "npm run compile";
    else throw new Error("Aucune commande de build CMake ou npm détectée.");
    return this.runTerminal({ command, cwd: path.relative(workspace, project) || "." }, signal, startedAt);
  }

  private async runTests(args: Record<string, unknown>, signal: AbortSignal, startedAt: number): Promise<LiixToolExecutionResult> {
    const explicit = optionalString(args, "command");
    if (explicit) return this.runTerminal({ command: explicit }, signal, startedAt);
    const workspace = this.workspaceRoot();
    const command = fs.existsSync(path.join(workspace, "package.json")) ? "npm test" : "ctest --test-dir build/qc1 --output-on-failure";
    return this.runTerminal({ command }, signal, startedAt);
  }

  private async gitDiff(args: Record<string, unknown>, signal: AbortSignal, startedAt: number): Promise<LiixToolExecutionResult> {
    const commandArgs = ["diff"];
    if (args.staged === true) commandArgs.push("--staged");
    const requested = optionalString(args, "path");
    if (requested) commandArgs.push("--", this.relative(this.resolvePath(requested)));
    return this.runGit(commandArgs, signal, startedAt, "Diff Git lu");
  }

  private async gitLog(args: Record<string, unknown>, signal: AbortSignal, startedAt: number): Promise<LiixToolExecutionResult> {
    const limit = clampInteger(args.limit, 1, 30, 10);
    return this.runGit(["log", `-${limit}`, "--oneline", "--decorate"], signal, startedAt, "Historique Git lu");
  }

  private async gitShow(args: Record<string, unknown>, signal: AbortSignal, startedAt: number): Promise<LiixToolExecutionResult> {
    const revision = requiredString(args, "revision");
    if (!/^[A-Za-z0-9_./~^:{\}-]+$/.test(revision) || revision.startsWith("-")) throw new Error("Révision Git invalide.");
    return this.runGit(["show", "--stat", "--oneline", revision], signal, startedAt, "Objet Git lu");
  }

  private async runGit(args: string[], signal: AbortSignal, startedAt: number, summary: string): Promise<LiixToolExecutionResult> {
    const result = await this.runProcess("git", args, this.workspaceRoot(), signal, 30_000, false);
    return this.processResult(`git_${args[0]}`, result, startedAt, result.ok ? summary : "Commande Git échouée");
  }

  private runProcess(
    executable: string,
    args: string[],
    cwd: string,
    signal: AbortSignal,
    timeoutMs: number,
    emitLive: boolean
  ): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null; spawnError?: string }> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let child: ChildProcess;
      const finish = (exitCode: number | null, spawnError?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (this.activeProcess === child) this.activeProcess = undefined;
        resolve({ ok: exitCode === 0 && !spawnError, stdout: truncate(stdout), stderr: truncate(stderr), exitCode, spawnError });
      };
      const abort = (): void => {
        child.kill("SIGTERM");
      };
      child = spawn(executable, args, { cwd, env: process.env, windowsHide: true });
      this.activeProcess = child;
      const timer = setTimeout(() => {
        stderr += `\n[Liix] Processus expiré après ${timeoutMs} ms.`;
        child.kill("SIGTERM");
      }, timeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      child.stdout?.on("data", (data: Buffer | string) => {
        const chunk = data.toString();
        stdout += chunk;
        if (emitLive) this.onEvent({ toolCallId: this.activeToolCallId, name: "run_terminal", state: "running", summary: "stdout", stdout: chunk });
      });
      child.stderr?.on("data", (data: Buffer | string) => {
        const chunk = data.toString();
        stderr += chunk;
        if (emitLive) this.onEvent({ toolCallId: this.activeToolCallId, name: "run_terminal", state: "running", summary: "stderr", stderr: chunk });
      });
      child.on("error", (error) => finish(null, error.message));
      child.on("close", (code) => finish(code));
      if (signal.aborted) abort();
    });
  }

  private processResult(
    name: string,
    result: { ok: boolean; stdout: string; stderr: string; exitCode: number | null; spawnError?: string },
    startedAt: number,
    summary: string
  ): LiixToolExecutionResult {
    return {
      ok: result.ok,
      name,
      summary: result.spawnError ? `${summary}: ${result.spawnError}` : summary,
      details: [`Exit: ${result.exitCode ?? "--"}`, "", "stdout:", result.stdout || "--", "", "stderr:", result.stderr || "--"].join("\n"),
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: Date.now() - startedAt
    };
  }

  private success(
    name: string,
    summary: string,
    details: string,
    startedAt: number,
    extras: Partial<LiixToolExecutionResult> = {}
  ): LiixToolExecutionResult {
    return { ok: true, name, summary, details: truncate(details), durationMs: Date.now() - startedAt, ...extras };
  }

  private failure(name: string, summary: string, startedAt: number): LiixToolExecutionResult {
    return { ok: false, name, summary, details: summary, durationMs: Date.now() - startedAt };
  }

  private workspaceRoot(): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) throw new Error("Aucun workspace ouvert.");
    return path.resolve(root);
  }

  private resolvePath(input: string): string {
    const root = this.workspaceRoot();
    const absolute = resolveInsideWorkspace(root, input);
    const realRoot = fs.realpathSync(root);
    let existing = absolute;
    while (!fs.existsSync(existing) && existing !== path.dirname(existing)) existing = path.dirname(existing);
    const realExisting = fs.realpathSync(existing);
    const reconstructed = path.resolve(realExisting, path.relative(existing, absolute));
    resolveInsideWorkspace(realRoot, reconstructed);
    return absolute;
  }

  private isInsideWorkspace(candidate: string): boolean {
    try { this.resolvePath(candidate); return true; } catch { return false; }
  }

  private relative(filePath: string): string {
    return path.relative(this.workspaceRoot(), filePath) || ".";
  }

  private recordCheckpoint(filePath: string, existed: boolean, content: Uint8Array): void {
    this.lastCheckpoint = { filePath, existed, content };
    this.lastChangedFiles = [filePath];
  }

  private async ensureDocumentCanBeWritten(filePath: string): Promise<void> {
    const open = vscode.workspace.textDocuments.find((document) => document.uri.fsPath === filePath);
    if (open?.isDirty) throw new Error("Le fichier contient des modifications non enregistrées. Enregistre-le avant l'édition Liix.");
  }
}

function requiredString(args: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = args[key];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`Paramètre '${key}' manquant ou invalide.`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === "string" && (args[key] as string).trim() ? args[key] as string : undefined;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

function truncate(value: string): string {
  return value.length > MAX_OUTPUT_CHARS ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n[Sortie tronquée par Liix]` : value;
}

function diffStats(before: string, after: string): { additions: number; deletions: number } {
  const beforeLines = before ? before.split(/\r?\n/) : [];
  const afterLines = after ? after.split(/\r?\n/) : [];
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < beforeLines.length - prefix && suffix < afterLines.length - prefix && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]) suffix += 1;
  return { additions: Math.max(0, afterLines.length - prefix - suffix), deletions: Math.max(0, beforeLines.length - prefix - suffix) };
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function describeCall(call: LiixToolCall): string {
  const target = call.arguments.path || call.arguments.command || call.arguments.query || "";
  return `${call.name}${target ? ` · ${String(target).slice(0, 160)}` : ""}`;
}

function abortError(): Error {
  const error = new Error("Opération Liix annulée.");
  error.name = "AbortError";
  return error;
}
