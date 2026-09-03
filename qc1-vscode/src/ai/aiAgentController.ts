/**
 * RÉSUMÉ — CONTRÔLEUR DE LA BOUCLE AGENTIQUE LIIX
 *
 * Le contrôleur relie conversation, modèle, permissions et outils. Il rappelle le
 * modèle après chaque résultat jusqu'à une réponse finale, avec limites d'étapes,
 * d'appels, annulation réelle et événements détaillés pour la Webview.
 */

import * as vscode from "vscode";
import { getActiveLiixModel, sendLiixModelTurn } from "./aiClient";
import { LiixConversationManager } from "./aiConversation";
import { LiixAgentMode, LiixPermissionDecision, LiixPermissionRequest } from "./aiAgent";
import { LiixPermissionManager } from "./aiPermissions";
import { LiixModelTurn, LiixToolCall, LiixUsage } from "./aiProtocol";
import { LiixToolEvent, LiixToolExecutionResult, LiixToolExecutor } from "./aiToolExecutor";
import { getToolMetadata, getToolsForMode } from "./aiTools";

export type LiixAgentControllerEvent =
  | { type: "status"; requestId: string; state: string; label: string }
  | { type: "assistantStart"; requestId: string; turnId: string }
  | { type: "assistantDelta"; requestId: string; turnId: string; content: string }
  | { type: "assistantFinal"; requestId: string; turnId: string; content: string }
  | { type: "tool"; requestId: string; event: LiixToolEvent }
  | { type: "usage"; requestId: string; usage?: LiixUsage; latencyMs: number; model: string }
  | { type: "task"; requestId: string; task: LiixTaskSnapshot }
  | { type: "error"; requestId: string; message: string }
  | { type: "done"; requestId: string; cancelled: boolean };

export interface LiixTaskSnapshot {
  title: string;
  state: "running" | "success" | "error" | "cancelled";
  startedAt: number;
  durationMs: number;
  steps: number;
  toolCalls: number;
  terminalCommands: number;
  modifiedFiles: string[];
}

export type LiixPermissionPrompt = (
  request: LiixPermissionRequest,
  call: LiixToolCall,
  signal: AbortSignal
) => Promise<LiixPermissionDecision>;

const SYSTEM_PROMPT = `Tu es Liix Code Agent, un assistant de programmation intégré à VS Code.

Règles obligatoires:
- Inspecte et lis les fichiers avant toute modification. N'invente jamais leur contenu.
- Utilise les outils read/search/diagnostics de manière sélective; ne demande pas tout le dépôt.
- Respecte strictement le workspace et les permissions retournées par l'extension.
- Fais des changements minimaux liés à la demande, puis relis et vérifie.
- Compile ou lance les tests quand c'est pertinent et utilise réellement stdout/stderr.
- Si un outil échoue, analyse son résultat avant de choisir la prochaine étape.
- Ne prétends jamais avoir lu, modifié ou exécuté quelque chose sans résultat d'outil.
- Ne crée aucun commit Git automatiquement.
- Termine par un résumé concis des modifications, validations et limites restantes.`;

export class LiixAgentController implements vscode.Disposable {
  private readonly conversation: LiixConversationManager;
  private readonly permissions = new LiixPermissionManager();
  private readonly executor: LiixToolExecutor;
  private active?: { requestId: string; controller: AbortController };
  private currentRequestId = "";
  private currentTask?: LiixTaskSnapshot;
  private readonly recentTasks: LiixTaskSnapshot[] = [];

  constructor(
    private readonly emit: (event: LiixAgentControllerEvent) => void,
    private readonly requestPermission: LiixPermissionPrompt
  ) {
    const contextChars = vscode.workspace.getConfiguration().get<number>("liix.contextBudgetChars", 80_000);
    this.conversation = new LiixConversationManager(SYSTEM_PROMPT, contextChars);
    this.executor = new LiixToolExecutor((event) => {
      if (!this.currentRequestId) return;
      if (event.name === "run_terminal" && (event.stdout || event.stderr)) {
        this.currentTask && (this.currentTask.terminalCommands = Math.max(1, this.currentTask.terminalCommands));
      }
      this.emit({ type: "tool", requestId: this.currentRequestId, event });
      this.publishTask();
    });
  }

  async run(prompt: string, mode: LiixAgentMode, requestId: string, model = getActiveLiixModel(), extraContext = ""): Promise<void> {
    if (this.active) throw new Error("Une tâche Liix est déjà en cours.");
    const abortController = new AbortController();
    this.active = { requestId, controller: abortController };
    this.currentRequestId = requestId;
    this.currentTask = {
      title: prompt.slice(0, 90), state: "running", startedAt: Date.now(), durationMs: 0,
      steps: 0, toolCalls: 0, terminalCommands: 0, modifiedFiles: []
    };
    this.conversation.addUser(extraContext ? `${prompt}\n\nContexte explicitement joint:\n${extraContext}` : prompt);
    this.publishTask();

    let totalCalls = 0;
    let lastUsage: LiixUsage | undefined;
    let totalLatency = 0;
    const maxSteps = vscode.workspace.getConfiguration().get<number>("liix.maxAgentSteps", 20);
    const maxToolCalls = Math.max(maxSteps, vscode.workspace.getConfiguration().get<number>("liix.maxToolCalls", 60));

    try {
      for (let iteration = 0; iteration < maxSteps; iteration += 1) {
        abortIfNeeded(abortController.signal);
        if (this.currentTask) this.currentTask.steps = iteration + 1;
        this.status(requestId, iteration === 0 ? "analyzing" : "analyzing", iteration === 0 ? "Liix analyse la demande" : "Liix analyse les résultats");
        const turnId = `${requestId}-turn-${iteration}`;
        let streamStarted = false;
        const turn = await sendLiixModelTurn({
          model,
          messages: this.conversation.modelContext(),
          tools: getToolsForMode(mode),
          signal: abortController.signal,
          onToken: (token) => {
            if (!streamStarted) {
              streamStarted = true;
              this.emit({ type: "assistantStart", requestId, turnId });
              this.status(requestId, "streaming", "Liix prépare la réponse");
            }
            this.emit({ type: "assistantDelta", requestId, turnId, content: token });
          }
        });
        abortIfNeeded(abortController.signal);
        lastUsage = turn.usage || lastUsage;
        totalLatency += turn.latencyMs;
        this.conversation.addAssistant(turn.content, turn.toolCalls);

        if (!turn.toolCalls.length) {
          if (!streamStarted) this.emit({ type: "assistantStart", requestId, turnId });
          this.emit({ type: "assistantFinal", requestId, turnId, content: turn.content || "Liix n'a retourné aucun contenu." });
          this.emit({ type: "usage", requestId, usage: lastUsage, latencyMs: totalLatency, model: turn.model || model });
          this.completeTask("success");
          this.status(requestId, "done", "Terminé");
          this.emit({ type: "done", requestId, cancelled: false });
          return;
        }

        if (streamStarted) this.emit({ type: "assistantFinal", requestId, turnId, content: turn.content });

        for (const call of turn.toolCalls) {
          abortIfNeeded(abortController.signal);
          totalCalls += 1;
          if (totalCalls > maxToolCalls) throw new Error(`Limite de ${maxToolCalls} appels d'outils atteinte.`);
          if (this.currentTask) this.currentTask.toolCalls = totalCalls;
          const result = await this.executeCall(call, mode, abortController.signal);
          this.conversation.addTool(call.id, call.name, serializeResult(result));
          if (result.affectedFiles?.length) {
            const metadata = getToolMetadata(call.name);
            if (metadata?.mutates && this.currentTask) {
              this.currentTask.modifiedFiles = [...new Set([...this.currentTask.modifiedFiles, ...result.affectedFiles])];
            }
          }
          this.publishTask();
        }
      }
      throw new Error(`Liix a atteint la limite de ${maxSteps} étapes sans réponse finale.`);
    } catch (error) {
      const cancelled = abortController.signal.aborted || (error instanceof Error && error.name === "AbortError");
      this.completeTask(cancelled ? "cancelled" : "error");
      if (!cancelled) this.emit({ type: "error", requestId, message: error instanceof Error ? error.message : String(error) });
      this.status(requestId, cancelled ? "idle" : "error", cancelled ? "Tâche arrêtée" : "Erreur agent");
      this.emit({ type: "done", requestId, cancelled });
    } finally {
      if (this.active?.requestId === requestId) this.active = undefined;
      this.currentRequestId = "";
      this.currentTask = undefined;
    }
  }

  /** Exécute un raccourci slash/terminal dans le même pipeline de sécurité. */
  async runSingleTool(call: LiixToolCall, mode: LiixAgentMode, requestId: string, title: string): Promise<void> {
    if (this.active) throw new Error("Une tâche Liix est déjà en cours.");
    const controller = new AbortController();
    this.active = { requestId, controller };
    this.currentRequestId = requestId;
    this.currentTask = {
      title, state: "running", startedAt: Date.now(), durationMs: 0,
      steps: 1, toolCalls: 1, terminalCommands: call.name === "run_terminal" ? 1 : 0, modifiedFiles: []
    };
    this.publishTask();
    try {
      const result = await this.executeCall(call, mode, controller.signal);
      if (result.affectedFiles?.length && getToolMetadata(call.name)?.mutates && this.currentTask) {
        this.currentTask.modifiedFiles = [...result.affectedFiles];
      }
      const turnId = `${requestId}-direct`;
      this.emit({ type: "assistantStart", requestId, turnId });
      this.emit({
        type: "assistantFinal",
        requestId,
        turnId,
        content: `${result.ok ? "Action terminée" : "Action échouée"}: **${result.summary}**\n\n${result.details}`
      });
      this.completeTask(result.ok ? "success" : "error");
      this.status(requestId, result.ok ? "done" : "error", result.ok ? "Terminé" : "Action échouée");
      this.emit({ type: "done", requestId, cancelled: false });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      this.completeTask(cancelled ? "cancelled" : "error");
      if (!cancelled) this.emit({ type: "error", requestId, message: error instanceof Error ? error.message : String(error) });
      this.emit({ type: "done", requestId, cancelled });
    } finally {
      this.active = undefined;
      this.currentRequestId = "";
      this.currentTask = undefined;
    }
  }

  cancel(): void {
    this.active?.controller.abort();
    this.executor.cancel();
  }

  newChat(): void {
    this.cancel();
    this.conversation.reset();
  }

  async undoLastEdit(): Promise<string> {
    return this.executor.undoLastEdit();
  }

  async openLastDiff(): Promise<void> {
    return this.executor.openLastDiff();
  }

  tasks(): LiixTaskSnapshot[] {
    return [...(this.currentTask ? [this.currentTask] : []), ...this.recentTasks].map((task) => ({ ...task, modifiedFiles: [...task.modifiedFiles] }));
  }

  dispose(): void {
    this.cancel();
    this.executor.dispose();
  }

  private async executeCall(call: LiixToolCall, mode: LiixAgentMode, signal: AbortSignal): Promise<LiixToolExecutionResult> {
    const verdict = this.permissions.verdict(call, mode);
    if (verdict === "deny") {
      return { ok: false, name: call.name, summary: `Outil ${call.name} interdit en mode ${mode.toUpperCase()}.`, details: "Permission refusée par la politique Liix.", durationMs: 0 };
    }
    if (verdict === "ask") {
      this.status(this.currentRequestId, "waiting_permission", `Permission requise: ${call.name}`);
      const decision = await this.requestPermission(this.permissions.createRequest(call), call, signal);
      if (decision === "deny") {
        return { ok: false, name: call.name, summary: "Action refusée par l'utilisateur.", details: "Permission refusée.", durationMs: 0 };
      }
      this.permissions.remember(call, decision);
    }
    this.status(this.currentRequestId, "running_tool", toolStatusLabel(call));
    return this.executor.execute(call, signal);
  }

  private status(requestId: string, state: string, label: string): void {
    this.emit({ type: "status", requestId, state, label });
  }

  private publishTask(): void {
    if (!this.currentTask || !this.currentRequestId) return;
    this.currentTask.durationMs = Date.now() - this.currentTask.startedAt;
    this.emit({ type: "task", requestId: this.currentRequestId, task: { ...this.currentTask, modifiedFiles: [...this.currentTask.modifiedFiles] } });
  }

  private completeTask(state: LiixTaskSnapshot["state"]): void {
    if (!this.currentTask) return;
    this.currentTask.state = state;
    this.currentTask.durationMs = Date.now() - this.currentTask.startedAt;
    this.recentTasks.unshift({ ...this.currentTask, modifiedFiles: [...this.currentTask.modifiedFiles] });
    this.recentTasks.splice(10);
    this.publishTask();
  }
}

function serializeResult(result: LiixToolExecutionResult): string {
  return JSON.stringify({
    ok: result.ok,
    summary: result.summary,
    details: result.details,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    affectedFiles: result.affectedFiles,
    additions: result.additions,
    deletions: result.deletions
  }, null, 2);
}

function toolStatusLabel(call: LiixToolCall): string {
  const value = call.arguments.path || call.arguments.command || call.arguments.query;
  return value ? `${call.name} · ${String(value).slice(0, 90)}` : call.name;
}

function abortIfNeeded(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Tâche Liix annulée.");
  error.name = "AbortError";
  throw error;
}
