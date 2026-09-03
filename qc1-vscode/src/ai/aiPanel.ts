/**
 * RÉSUMÉ — PONT ENTRE VS CODE, L'AGENT LIIX ET LA WEBVIEW
 *
 * Ce provider ne contient plus le CSS ni la boucle agentique. Il valide les messages
 * de la Webview, prépare les contextes explicitement joints, transmet les événements
 * du LiixAgentController et résout les demandes de permission inline.
 */

import { execFile } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  getLiixLocalApiType,
  getLiixLocalApiUrl,
  getLiixLocalModel,
  getActiveLiixModel,
  getLiixProvider,
  getLiixRuntimeConfig,
  LiixLocalApiType,
  LiixProvider,
  LiixToolCallingMode,
  setActiveLiixModel,
  testLiixConnection,
  updateLiixRuntimeConfig
} from "./aiClient";
import { detectAgentAction, getWorkspaceRoot, inspectRuntimeSnapshot, LiixAgentAction, LiixAgentMode, LiixPermissionDecision, LiixPermissionRequest, resolveWorkspacePath } from "./aiAgent";
import { LiixAgentController, LiixAgentControllerEvent } from "./aiAgentController";
import { formatActiveFileContext, getActiveFileContext } from "./aiContext";
import { summarizeDiagnostics } from "./aiErrorParser";
import { LiixToolCall } from "./aiProtocol";
import { getLiixWebviewHtml } from "./aiWebviewHtml";

type LiixContextAttachment = { id: string; type: string; label: string; value: string };

type WebviewMessage =
  | { type: "sendMessage"; requestId: string; modelId?: string; message?: string; mode?: LiixAgentMode; contexts?: LiixContextAttachment[] }
  | { type: "runTerminal"; requestId: string; command?: string; mode?: LiixAgentMode }
  | { type: "cancel"; requestId?: string }
  | { type: "newChat" }
  | { type: "permissionDecision"; permissionId: string; decision: LiixPermissionDecision }
  | { type: "contextRequest"; contextType: string }
  | { type: "copyText"; content?: string }
  | { type: "refreshModels" }
  | { type: "testConnection" }
  | { type: "selectModel"; modelId?: string }
  | { type: "undoLastEdit" }
  | { type: "openLastDiff" }
  | {
      type: "settingsChanged";
      provider?: LiixProvider;
      localApiType?: LiixLocalApiType;
      localApiUrl?: string;
      localModel?: string;
      defaultModel?: string;
      toolCallingMode?: LiixToolCallingMode;
    };

type PendingPermission = {
  resolve: (decision: LiixPermissionDecision) => void;
  abort: () => void;
};

export class LiixAiPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "liixAiChat";

  private view?: vscode.WebviewView;
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly controller: LiixAgentController;
  private lastTerminalOutput = "";

  constructor(private readonly extensionUri: vscode.Uri) {
    this.controller = new LiixAgentController(
      (event) => this.handleControllerEvent(event),
      (request, call, signal) => this.requestPermission(request, call, signal)
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = getLiixWebviewHtml({
      nonce: crypto.randomBytes(18).toString("base64"),
      provider: getLiixProvider(),
      model: getActiveLiixModel(),
      workspace: getWorkspaceRoot() || "Aucun workspace",
      localApiUrl: getLiixLocalApiUrl(),
      localApiType: getLiixLocalApiType(),
      toolCallingMode: vscode.workspace.getConfiguration().get<string>("liix.supportsToolCalling", "auto")
    });
    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => void this.routeMessage(message));
    webviewView.onDidDispose(() => {
      this.controller.cancel();
      this.rejectPendingPermissions("Webview fermée.");
      this.view = undefined;
    });
    void this.postRuntimeState();
  }

  /** Méthodes publiques utilisées par les commandes de la palette VS Code. */
  newChat(): void {
    this.controller.newChat();
    this.post({ type: "newChat" });
  }

  stop(): void {
    this.controller.cancel();
  }

  async undoLastEdit(): Promise<void> {
    this.postToast(await this.controller.undoLastEdit());
  }

  async openLastDiff(): Promise<void> {
    try { await this.controller.openLastDiff(); }
    catch (error) { this.postToast(error instanceof Error ? error.message : String(error)); }
  }

  async refreshModels(): Promise<void> {
    await this.postRuntimeState();
  }

  requestPrompt(prompt: string, mode: LiixAgentMode = "agent"): void {
    this.post({ type: "externalPrompt", prompt, mode });
  }

  showPage(page: "chat" | "tasks" | "terminal" | "settings"): void {
    this.post({ type: "navigate", page });
  }

  dispose(): void {
    this.rejectPendingPermissions("Extension désactivée.");
    this.controller.dispose();
  }

  private async routeMessage(message: WebviewMessage): Promise<void> {
    try {
      switch (message.type) {
        case "sendMessage": await this.handleSendMessage(message); break;
        case "runTerminal": await this.handleTerminal(message); break;
        case "cancel": this.controller.cancel(); break;
        case "newChat": this.newChat(); break;
        case "permissionDecision": this.resolvePermission(message.permissionId, message.decision); break;
        case "contextRequest": await this.addContext(message.contextType); break;
        case "copyText": await vscode.env.clipboard.writeText(message.content || ""); this.postToast("Copié."); break;
        case "refreshModels": await this.postRuntimeState(); break;
        case "testConnection": this.post({ type: "connectionTest", result: await testLiixConnection() }); break;
        case "selectModel": if (message.modelId) { await setActiveLiixModel(message.modelId); await this.postRuntimeState(); } break;
        case "undoLastEdit": await this.undoLastEdit(); break;
        case "openLastDiff": await this.openLastDiff(); break;
        case "settingsChanged":
          await updateLiixRuntimeConfig(message);
          await this.postRuntimeState();
          this.postToast("Runtime Liix enregistré.");
          break;
      }
    } catch (error) {
      this.post({ type: "errorMessage", content: error instanceof Error ? error.message : String(error) });
      if ("requestId" in message && typeof message.requestId === "string") this.post({ type: "requestDone", requestId: message.requestId });
    }
  }

  private async handleSendMessage(message: Extract<WebviewMessage, { type: "sendMessage" }>): Promise<void> {
    const prompt = (message.message || "").trim();
    if (!prompt) throw new Error("Écris un message avant d'envoyer.");
    const mode = message.mode || "chat";
    const legacy = detectAgentAction(prompt);
    if (legacy) {
      const call = legacyActionToToolCall(legacy, message.requestId);
      await this.controller.runSingleTool(call, mode, message.requestId, prompt);
      return;
    }
    const context = (message.contexts || [])
      .slice(0, 8)
      .map((item) => `[${item.label}]\n${item.value.slice(0, 12_000)}`)
      .join("\n\n");
    await this.controller.run(prompt, mode, message.requestId, message.modelId, context);
  }

  private async handleTerminal(message: Extract<WebviewMessage, { type: "runTerminal" }>): Promise<void> {
    const command = (message.command || "").trim();
    if (!command) throw new Error("Commande terminal vide.");
    const call: LiixToolCall = { id: `${message.requestId}-terminal`, name: "run_terminal", arguments: { command } };
    await this.controller.runSingleTool(call, message.mode || "full", message.requestId, command);
  }

  private handleControllerEvent(event: LiixAgentControllerEvent): void {
    switch (event.type) {
      case "status": this.post({ type: "agentStatus", requestId: event.requestId, state: event.state, label: event.label }); break;
      case "assistantStart": this.post(event); break;
      case "assistantDelta": this.post(event); break;
      case "assistantFinal": this.post(event); break;
      case "tool":
        if (event.event.stdout) this.lastTerminalOutput = keepTail(`${this.lastTerminalOutput}\n${event.event.stdout}`);
        if (event.event.stderr) this.lastTerminalOutput = keepTail(`${this.lastTerminalOutput}\n${event.event.stderr}`);
        this.post({ type: "toolEvent", requestId: event.requestId, event: event.event });
        break;
      case "usage": this.post(event); break;
      case "task": this.post(event); break;
      case "error": this.post({ type: "errorMessage", requestId: event.requestId, content: event.message }); break;
      case "done": this.post({ type: "requestDone", requestId: event.requestId, cancelled: event.cancelled }); break;
    }
  }

  private requestPermission(request: LiixPermissionRequest, _call: LiixToolCall, signal: AbortSignal): Promise<LiixPermissionDecision> {
    return new Promise((resolve) => {
      const abort = () => {
        this.pendingPermissions.delete(request.id);
        resolve("deny");
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pendingPermissions.set(request.id, {
        resolve: (decision) => {
          signal.removeEventListener("abort", abort);
          resolve(decision);
        },
        abort
      });
      this.post({ type: "permissionRequest", request });
    });
  }

  private resolvePermission(id: string, decision: LiixPermissionDecision): void {
    const pending = this.pendingPermissions.get(id);
    if (!pending) return;
    this.pendingPermissions.delete(id);
    pending.resolve(decision);
  }

  private rejectPendingPermissions(_reason: string): void {
    for (const pending of this.pendingPermissions.values()) pending.abort();
    this.pendingPermissions.clear();
  }

  private async addContext(type: string): Promise<void> {
    const context = await collectContext(type, this.lastTerminalOutput);
    if (context) this.post({ type: "contextAdded", context });
  }

  private async postRuntimeState(): Promise<void> {
    const localProvider = getLiixProvider() === "local";
    const [config, connection] = await Promise.all([
      getLiixRuntimeConfig(),
      localProvider ? testLiixConnection() : Promise.resolve(undefined)
    ]);
    const snapshot = await inspectRuntimeSnapshot(config.provider, config.provider === "local");
    this.post({
      type: "runtime",
      runtime: {
        ...snapshot,
        activeProvider: config.provider,
        activeMode: config.mode,
        activeEndpoint: config.endpoint,
        activeModel: config.model,
        localApiType: config.localApiType,
        localApiUrl: getLiixLocalApiUrl(),
        localModel: config.localModel,
        toolCallingMode: config.toolCallingMode,
        models: config.models,
        connected: connection?.connected ?? true
      }
    });
  }

  private post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }

  private postToast(content: string): void {
    this.post({ type: "toast", content });
  }
}

async function collectContext(type: string, terminalOutput: string): Promise<LiixContextAttachment | undefined> {
  const id = `${type}-${Date.now()}`;
  if (type === "activeFile") {
    const active = getActiveFileContext();
    if (!active) throw new Error("Aucun fichier actif.");
    resolveWorkspacePath(active.fileName);
    return { id, type, label: path.basename(active.fileName), value: formatActiveFileContext(active) };
  }
  if (type === "selection") {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) throw new Error("Aucune sélection active.");
    resolveWorkspacePath(editor.document.fileName);
    return { id, type, label: `Sélection · ${path.basename(editor.document.fileName)}`, value: editor.document.getText(editor.selection).slice(0, 12_000) };
  }
  if (type === "diagnostics") {
    const summary = summarizeDiagnostics();
    return { id, type, label: `Diagnostics · ${summary.errors} erreur(s)`, value: summary.diagnostics.join("\n") || "Aucun diagnostic." };
  }
  if (type === "terminal") return { id, type, label: "Dernier terminal", value: terminalOutput || "Aucune sortie terminal." };
  if (type === "gitDiff") {
    const root = getWorkspaceRoot();
    if (!root) throw new Error("Aucun workspace ouvert.");
    return { id, type, label: "Git diff", value: await readGitDiff(root) };
  }
  if (type === "file" || type === "folder") {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: type === "file",
      canSelectFolders: type === "folder",
      canSelectMany: false,
      defaultUri: getWorkspaceRoot() ? vscode.Uri.file(getWorkspaceRoot()) : undefined,
      openLabel: "Ajouter au contexte Liix"
    });
    const selected = selection?.[0];
    if (!selected) return undefined;
    const safePath = resolveWorkspacePath(selected.fsPath);
    if (type === "file") {
      const value = (await fs.promises.readFile(safePath, "utf8")).slice(0, 12_000);
      return { id, type, label: path.basename(safePath), value };
    }
    const entries = (await fs.promises.readdir(safePath, { withFileTypes: true })).slice(0, 200).map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`);
    return { id, type, label: path.basename(safePath), value: entries.join("\n") };
  }
  throw new Error(`Type de contexte inconnu: ${type}`);
}

function legacyActionToToolCall(action: LiixAgentAction, requestId: string): LiixToolCall {
  const args: Record<string, unknown> = {};
  let name: string;
  switch (action.kind) {
    case "readFile": name = "read_file"; args.path = action.filePath; break;
    case "writeFile": name = fs.existsSync(resolveWorkspacePath(action.filePath || "")) ? "write_file" : "create_file"; args.path = action.filePath; args.content = action.content || ""; break;
    case "deleteFile": name = "delete_file"; args.path = action.filePath; break;
    case "terminal": name = "run_terminal"; args.command = action.command; break;
    case "project": name = "inspect_project"; break;
    case "errors": name = "get_diagnostics"; break;
    case "git": {
      const command = action.command || "git status";
      if (/^git\s+status\b/i.test(command)) name = "git_status";
      else if (/^git\s+diff\b/i.test(command)) name = "git_diff";
      else if (/^git\s+log\b/i.test(command)) name = "git_log";
      else if (/^git\s+show\s+/i.test(command)) { name = "git_show"; args.revision = command.replace(/^git\s+show\s+/i, "").trim(); }
      else { name = "run_terminal"; args.command = command; }
      break;
    }
  }
  return { id: `${requestId}-slash`, name, arguments: args };
}

function readGitDiff(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["diff", "--"], { cwd, timeout: 10_000, encoding: "utf8", maxBuffer: 512 * 1024 }, (_error, stdout, stderr) => resolve(keepTail(`${stdout || ""}\n${stderr || ""}`) || "Aucun diff."));
  });
}

function keepTail(value: string): string {
  return value.length > 20_000 ? value.slice(-20_000) : value;
}
