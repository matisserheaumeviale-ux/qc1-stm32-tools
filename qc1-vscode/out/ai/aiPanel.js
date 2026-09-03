"use strict";
/**
 * RÉSUMÉ DU FICHIER — INTERFACE UTILISATEUR LIIX AI
 *
 * Ce fichier contrôle la seconde Webview de l'extension, affichée sous l'icône Liix AI.
 * Il contient à la fois le contrôleur TypeScript et la page HTML/CSS/JavaScript du chat.
 *
 * Flux principal :
 *   clic/message dans le HTML -> `vscode.postMessage()` -> `onDidReceiveMessage()`
 *   -> client IA ou action agent -> `this.view.webview.postMessage()` -> mise à jour DOM
 *
 * Repères pour modifier l'interface :
 * - `LiixUiState` : étapes possibles d'une requête;
 * - `resolveWebviewView()` : route les messages reçus de la page;
 * - méthodes `post...()` : renvoient les résultats vers la page;
 * - `getHtml()` : contient tout le visuel;
 * - `startLoadingBubble()` : crée l'anneau de chargement;
 * - `setAgentStatus()` : décide quand afficher/retirer ce chargement.
 *
 * Le chargement Liix est une animation d'attente et une suite d'états, pas une barre
 * de téléchargement ni un pourcentage réel. Les fichiers `out/ai/*.js` sont générés
 * par TypeScript : modifier ce fichier source puis lancer `npm run compile`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiixAiPanelProvider = void 0;
const vscode = require("vscode");
const aiClient_1 = require("./aiClient");
const aiContext_1 = require("./aiContext");
const aiModels_1 = require("./aiModels");
const aiAgent_1 = require("./aiAgent");
class LiixAiPanelProvider {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this.client = new aiClient_1.LiixAiClient();
        this.pendingPermissions = new Map();
        this.sessionAllowed = new Set();
        this.alwaysAllowed = new Set();
    }
    /** Crée la page puis branche le routeur Webview -> extension. */
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = this.getHtml();
        this.postRuntimeState();
        // Chaque case correspond à un `vscode.postMessage({ type: ... })` dans getHtml().
        webviewView.webview.onDidReceiveMessage(async (message) => {
            try {
                switch (message.type) {
                    case "sendMessage":
                        await this.handleSendMessage(message);
                        break;
                    case "runQuickAction":
                        await this.handleAgentAction(message.action, message.mode || "agent", message.requestId);
                        break;
                    case "permissionDecision":
                        await this.handlePermissionDecision(message.requestId, message.decision);
                        break;
                    case "readActiveFile":
                        await this.handleReadActiveFile(message.modelId, message.requestId);
                        break;
                    case "analyzeErrors":
                        await this.handleAgentAction({ kind: "errors" }, "agent", message.requestId);
                        break;
                    case "copyApiKey":
                        await vscode.env.clipboard.writeText(this.getMaskedApiKey());
                        this.postToast("API key masquée copiée.");
                        break;
                    case "refreshRuntime":
                        await this.postRuntimeState();
                        break;
                    case "refreshModels":
                        await this.postRuntimeState(true);
                        break;
                    case "selectModel":
                        if (message.modelId) {
                            await (0, aiClient_1.setActiveLiixModel)(message.modelId);
                            await this.postRuntimeState();
                        }
                        break;
                    case "settingsChanged":
                        await (0, aiClient_1.updateLiixRuntimeConfig)({
                            provider: message.provider,
                            localApiType: message.localApiType,
                            localApiUrl: message.localApiUrl,
                            localModel: message.localModel,
                            defaultModel: message.defaultModel
                        });
                        await this.postRuntimeState(true);
                        break;
                }
            }
            catch (error) {
                console.error("Liix AI webview error", error);
                this.postErrorMessage(error);
            }
        });
    }
    /** Pipeline d'une demande : outil éventuel, contexte du fichier, appel IA, réponse UI. */
    async handleSendMessage(message) {
        const text = (message.message || "").trim();
        const mode = message.mode || "chat";
        const requestId = message.requestId;
        if (!text) {
            this.postAssistantMessage("Écris un message avant d'envoyer.", requestId);
            return;
        }
        this.postUserMessage(text, requestId);
        this.postAgentStatus("analyzing", "Analyse de la demande...", requestId);
        const action = (0, aiAgent_1.detectAgentAction)(text);
        let toolContext = "";
        if (action && mode !== "chat") {
            this.postAgentStatus("running_tool", "Exécution de la commande...", requestId);
            const result = await this.prepareOrRunAction(action, mode, requestId);
            if (!result) {
                return;
            }
            toolContext = [
                `Résultat outil: ${result.title}`,
                result.summary,
                result.details
            ].join("\n");
        }
        this.postAgentStatus("reading_context", "Lecture du contexte workspace...", requestId);
        const activeFile = (0, aiContext_1.getActiveFileContext)();
        const response = await this.client.sendMessage({
            modelId: message.modelId || aiModels_1.liixAiModels[0].id,
            message: buildPrompt(text, mode, toolContext),
            context: activeFile ? (0, aiContext_1.formatActiveFileContext)(activeFile) : toolContext,
            contextMode: mode,
            permissions: mode === "chat"
                ? { fileWrite: "none", terminal: "none" }
                : mode === "agent"
                    ? { fileWrite: "ask", terminal: "build" }
                    : { fileWrite: "auto", terminal: "ask" },
            workspace: (0, aiAgent_1.getWorkspaceRoot)(),
            activeFile: activeFile?.fileName
        });
        this.postAgentStatus("streaming", "Réponse en cours...", requestId);
        this.postAssistantMessage(response.content || "Aucune réponse reçue.", requestId);
        this.postUsage(text, response.content, message.modelId || aiModels_1.liixAiModels[0].id);
    }
    async handleReadActiveFile(modelId, requestId) {
        this.postAgentStatus("reading_context", "Lecture du contexte workspace...", requestId);
        const activeFile = (0, aiContext_1.getActiveFileContext)();
        if (!activeFile) {
            this.postAssistantMessage("Aucun fichier actif ouvert dans VS Code.", requestId);
            return;
        }
        const response = await this.client.sendMessage({
            modelId: modelId || aiModels_1.liixAiModels[0].id,
            message: `Lis et résume le fichier actif ${activeFile.fileName}.`,
            context: (0, aiContext_1.formatActiveFileContext)(activeFile),
            contextMode: "file",
            mode: "file",
            workspace: (0, aiAgent_1.getWorkspaceRoot)(),
            activeFile: activeFile.fileName
        });
        this.postAgentStatus("streaming", "Réponse en cours...", requestId);
        this.postAssistantMessage([
            `Fichier actif lu: ${activeFile.fileName}`,
            `Langage: ${activeFile.languageId}`,
            `Lignes: ${activeFile.lineCount}`,
            "",
            response.content
        ].join("\n"), requestId);
    }
    async handleAgentAction(action, mode, requestId) {
        this.postAgentStatus("running_tool", "Exécution de la commande...", requestId);
        const result = await this.prepareOrRunAction(action, mode, requestId);
        if (result) {
            this.postAgentStatus("streaming", "Réponse en cours...", requestId);
            this.postAssistantMessage([
                `${result.ok ? "Action terminée" : "Action échouée"}: ${result.title}`,
                result.summary,
                "",
                result.details
            ].join("\n"), requestId);
        }
    }
    async prepareOrRunAction(action, mode, requestId) {
        const permissionKey = createPermissionKey(action);
        if ((0, aiAgent_1.requiresPermission)(action, mode) &&
            !this.sessionAllowed.has(permissionKey) &&
            !this.alwaysAllowed.has(permissionKey)) {
            const request = (0, aiAgent_1.createPermissionRequest)(action);
            this.pendingPermissions.set(request.id, { request, requestId, action, mode });
            this.postPermissionRequest(request, requestId);
            this.postAgentStatus("waiting_permission", "Permission requise", requestId);
            return undefined;
        }
        this.postTerminalEvent(`$ ${action.command || action.kind}${action.filePath ? ` ${action.filePath}` : ""}`, "command", requestId);
        const result = await (0, aiAgent_1.runAgentAction)(action, mode);
        this.postAgentResult(result, requestId);
        return result;
    }
    async handlePermissionDecision(requestId, decision) {
        const pending = this.pendingPermissions.get(requestId);
        if (!pending) {
            return;
        }
        this.pendingPermissions.delete(requestId);
        if (decision === "deny") {
            this.postAssistantMessage("Action refusée.", pending.requestId);
            this.postAgentStatus("error", "Permission refusée", pending.requestId);
            return;
        }
        const key = createPermissionKey(pending.action);
        if (decision === "allowSession") {
            this.sessionAllowed.add(key);
        }
        if (decision === "alwaysAllow") {
            this.alwaysAllowed.add(key);
        }
        this.postAgentStatus("running_tool", "Exécution de la commande...", pending.requestId);
        this.postTerminalEvent(`$ ${pending.action.command || pending.action.kind}${pending.action.filePath ? ` ${pending.action.filePath}` : ""}`, "command", pending.requestId);
        const result = await (0, aiAgent_1.runAgentAction)(pending.action, pending.mode);
        this.postAgentResult(result, pending.requestId);
        this.postAgentStatus("streaming", "Réponse en cours...", pending.requestId);
        this.postAssistantMessage([
            `${result.ok ? "Action autorisée et terminée" : "Action autorisée mais échouée"}: ${result.title}`,
            result.summary,
            "",
            result.details
        ].join("\n"), pending.requestId);
    }
    async postRuntimeState(showModelChangeNotice = false) {
        const currentProvider = (0, aiClient_1.getLiixProvider)();
        const beforeModel = currentProvider === "local" ? (0, aiClient_1.getLiixLocalModel)() : vscode.workspace.getConfiguration().get("liix.defaultModel", aiModels_1.liixAiModels[0].id);
        const runtimeConfig = await (0, aiClient_1.getLiixRuntimeConfig)();
        const provider = runtimeConfig.provider;
        const localMode = provider === "local";
        const snapshot = await (0, aiAgent_1.inspectRuntimeSnapshot)(provider, localMode);
        this.view?.webview.postMessage({
            type: "runtime",
            runtime: {
                ...snapshot,
                apiKeyMasked: this.getMaskedApiKey(),
                activeProvider: runtimeConfig.provider,
                activeMode: runtimeConfig.mode,
                activeEndpoint: runtimeConfig.endpoint,
                activeModel: runtimeConfig.model,
                localApiType: runtimeConfig.localApiType,
                localApiUrl: (0, aiClient_1.getLiixLocalApiUrl)(),
                localModel: runtimeConfig.localModel,
                models: runtimeConfig.models,
                account: {
                    name: vscode.workspace.getConfiguration().get("liix.userName", "Utilisateur Liix"),
                    email: vscode.workspace.getConfiguration().get("liix.accountEmail", ""),
                    subscription: localMode ? "Local" : "Developer"
                }
            }
        });
        if (showModelChangeNotice && beforeModel !== runtimeConfig.model) {
            this.view?.webview.postMessage({
                type: "systemMessage",
                content: "Modèle changé automatiquement pour correspondre au provider actif."
            });
        }
    }
    postUserMessage(content, requestId) {
        this.view?.webview.postMessage({ type: "userMessage", requestId, content });
    }
    postAssistantMessage(content, requestId) {
        this.view?.webview.postMessage({ type: "assistantMessage", requestId, content });
    }
    postPermissionRequest(request, requestId) {
        this.view?.webview.postMessage({ type: "permissionRequest", requestId, request });
    }
    postTerminalEvent(content, stream = "command", requestId) {
        this.view?.webview.postMessage({ type: "terminalEvent", requestId, content, stream });
    }
    postAgentResult(result, requestId) {
        if (result.stdout || result.stderr) {
            if (result.stdout) {
                this.postTerminalEvent(result.stdout.trim() || "--", "stdout", requestId);
            }
            if (result.stderr) {
                this.postTerminalEvent(result.stderr.trim() || "--", "stderr", requestId);
            }
            return;
        }
        this.postTerminalEvent(formatAgentResult(result), result.ok ? "stdout" : "stderr", requestId);
    }
    postUsage(prompt, response, modelId) {
        const promptTokens = estimateTokens(prompt);
        const responseTokens = estimateTokens(response);
        const provider = (0, aiClient_1.getLiixProvider)();
        this.view?.webview.postMessage({
            type: "usage",
            usage: {
                model: getRuntimeModelLabel(modelId),
                provider,
                local: provider === "local",
                promptTokens,
                responseTokens,
                totalTokens: promptTokens + responseTokens,
                cost: provider === "local" ? "Unlimited local usage" : "Usage API",
                latency: `${Math.max(0.2, responseTokens / 45).toFixed(1)}s`
            }
        });
    }
    /** Envoie l'étape courante; `setAgentStatus()` dans la page pilote ensuite le loader. */
    postAgentStatus(state, label, requestId) {
        this.view?.webview.postMessage({ type: "agentStatus", requestId, state, label });
    }
    postToast(content) {
        this.view?.webview.postMessage({ type: "toast", content });
    }
    postErrorMessage(error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.view?.webview.postMessage({
            type: "errorMessage",
            content: `Liix a rencontré un souci. ${detail}`
        });
        this.postAgentStatus("error", "Erreur");
    }
    getMaskedApiKey() {
        const apiKey = vscode.workspace.getConfiguration().get("liix.apiKey", "");
        if (!apiKey) {
            return "sk-****-****-none";
        }
        return `${apiKey.slice(0, 3)}-****-****-${apiKey.slice(-4)}`;
    }
    /** Construit toute la page Liix : styles, sections, contrôles et JavaScript client. */
    getHtml() {
        const modelOptions = aiModels_1.liixAiModels.map((model) => (`<option value="${escapeHtml(model.id)}">${escapeHtml(model.label)}</option>`)).join("");
        const defaultProvider = (0, aiClient_1.getLiixProvider)();
        const defaultModel = aiModels_1.liixAiModels[0]?.id || "liix-code-0.1";
        const workspace = (0, aiAgent_1.getWorkspaceRoot)() || "--";
        return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --panel: color-mix(in srgb, var(--vscode-sideBar-background) 88%, #020407);
      --panel-2: color-mix(in srgb, var(--vscode-sideBar-background) 94%, var(--vscode-editor-background));
      --sidebar: color-mix(in srgb, var(--vscode-sideBar-background) 94%, #08090c);
      --surface: color-mix(in srgb, var(--vscode-editor-background) 82%, #121318);
      --surface-2: color-mix(in srgb, var(--vscode-sideBar-background) 88%, #15161c);
      --surface-3: color-mix(in srgb, var(--vscode-input-background) 88%, #101116);
      --border: color-mix(in srgb, var(--vscode-panel-border) 62%, transparent);
      --border-soft: color-mix(in srgb, var(--vscode-panel-border) 34%, transparent);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --faint: color-mix(in srgb, var(--vscode-descriptionForeground) 72%, transparent);
      --blue: var(--vscode-button-background);
      --blue-hover: var(--vscode-button-hoverBackground);
      --red: #ff4f63;
      --red-soft: rgba(255, 79, 99, 0.16);
      --shadow: 0 8px 20px rgba(0, 0, 0, 0.22);
     --accent: #ff3b4d;
--accent-2: #ff4f63;
--accent-soft: color-mix(in srgb, #ff3b4d 14%, transparent);

--chat: #9aa0a6;

--full: #ff4458;

--danger: #ff5c74;
--warning: #e5b95c;
--ok: #58d68d;

--code: #07080c;
    }

    * { box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body {
      margin: 0;
      padding: 0;
      color: var(--fg);
      background:
        radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--blue) 12%, transparent), transparent 30%),
        linear-gradient(180deg, color-mix(in srgb, var(--bg) 92%, #03060a) 0%, var(--bg) 100%);
      font-family: var(--vscode-font-family);
      font-size: 12px;
      letter-spacing: 0;
    }

    button, select, input, textarea {
      font: inherit;
      color: var(--fg);
      background: var(--surface-3);
      border: 1px solid var(--border);
      border-radius: 6px;
      outline: none;
    }

    button {
      min-height: 28px;
      padding: 4px 9px;
      cursor: pointer;
    }

    button:hover, select:hover, input:hover, textarea:hover {
      border-color: color-mix(in srgb, var(--muted) 42%, var(--border));
    }

    button.primary {
      background: color-mix(in srgb, var(--accent) 74%, #11131a);
      border-color: transparent;
      color: #fff;
    }

    button.ghost {
      background: transparent;
    }

    button.danger {
      color: var(--danger);
      border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
      background: color-mix(in srgb, var(--danger) 10%, transparent);
    }

    select, input {
      height: 28px;
      padding: 3px 8px;
      min-width: 0;
    }

    textarea {
      width: 100%;
      min-height: 56px;
      max-height: 150px;
      resize: vertical;
      padding: 8px 9px;
      line-height: 1.42;
    }

    .app {
      height: 100vh;
      display: grid;
      grid-template-columns: 52px minmax(0, 1fr);
      min-width: 0;
      background:
        radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--blue) 12%, transparent), transparent 30%),
        linear-gradient(180deg, color-mix(in srgb, var(--bg) 92%, #03060a) 0%, var(--bg) 100%);
    }

    .rail {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 8px 6px;
      border-right: 1px solid var(--border);
      background: var(--sidebar);
    }

    .mark {
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      border-radius: 8px;
      color: #fff;
      background: linear-gradient(145deg, var(--accent-2), var(--accent));
      box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 22%, transparent);
      font-weight: 800;
      margin-bottom: 5px;
    }

    .nav-btn {
      width: 36px;
      height: 34px;
      display: grid;
      place-items: center;
      padding: 0;
      border-color: transparent;
      background: transparent;
      color: var(--muted);
      position: relative;
    }

    .nav-btn.active {
      color: var(--fg);
      background: color-mix(in srgb, var(--fg) 8%, transparent);
      border-color: var(--border-soft);
    }

    .nav-btn.active::before {
      content: "";
      position: absolute;
      left: -6px;
      width: 2px;
      height: 18px;
      border-radius: 99px;
      background: var(--accent);
    }

    .nav-icon { font-size: 14px; line-height: 1; }
    .shell { min-width: 0; height: 100vh; display: grid; grid-template-rows: auto 1fr auto; }
    .topbar {
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--surface) 96%, transparent);
    }

    .topbar-inner {
      width: min(100%, 960px);
      margin: 0 auto;
      min-height: 46px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: 6px 12px;
    }

    .title-row { display: flex; align-items: center; gap: 7px; min-width: 0; }
    .title { font-weight: 700; font-size: 13px; white-space: nowrap; }
    .meta-row {
      display: flex;
      gap: 7px;
      align-items: center;
      min-width: 0;
      color: var(--muted);
      font-size: 11px;
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
    }

    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .header-controls { display: flex; gap: 6px; align-items: center; min-width: 0; }
    .model-select { width: 170px; max-width: 34vw; }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 99px;
      display: inline-block;
      background: var(--ok);
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 40%, transparent);
    }

    .status-dot.active {
      animation: pulse 1.4s ease-in-out infinite;
      background: var(--warning);
    }

    .status-dot.waiting_permission, .status-dot.error {
      background: var(--danger);
    }

    .main {
      min-height: 0;
      overflow: hidden;
    }

    .page {
      display: none;
      height: 100%;
      overflow: auto;
      width: min(100%, 960px);
      margin: 0 auto;
      padding: 10px 12px;
    }

    .page.active { display: block; }
    .chat-page.active {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      gap: 8px;
      overflow: hidden;
    }

    .compact-strip {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
    }

    .mode-pills { display: flex; gap: 5px; min-width: 0; }
    .mode-pill {
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      color: var(--muted);
      background: transparent;
    }

    .mode-pill[data-mode="chat"].active {
      color: var(--fg);
      border-color: color-mix(in srgb, var(--chat) 52%, var(--border));
      background: color-mix(in srgb, var(--chat) 13%, transparent);
    }

    .mode-pill[data-mode="agent"].active {
      color: #ffd6c7;
      border-color: color-mix(in srgb, var(--accent) 58%, var(--border));
      background: var(--accent-soft);
    }

    .mode-pill[data-mode="full"].active {
      color: #ffd8c2;
      border-color: color-mix(in srgb, var(--full) 62%, var(--border));
      background: color-mix(in srgb, var(--full) 15%, transparent);
    }

    .runtime-card {
      display: flex;
      align-items: center;
      gap: 7px;
      color: var(--muted);
      font-size: 11px;
      min-width: 0;
    }

    .messages {
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 7px;
      padding: 1px 2px 4px 0;
      min-height: 0;
    }

    .msg {
      border: 1px solid var(--border-soft);
      border-radius: 8px;
      background: color-mix(in srgb, var(--surface-2) 86%, transparent);
      padding: 7px 9px;
      line-height: 1.43;
      word-break: break-word;
      animation: fadeIn 150ms ease-out;
      transition: border-color 160ms ease, background 160ms ease, opacity 160ms ease;
    }

    .msg.user {
      align-self: flex-end;
      max-width: 88%;
      background: color-mix(in srgb, var(--fg) 7%, var(--surface-2));
      border-color: color-mix(in srgb, var(--fg) 11%, var(--border-soft));
    }

    .msg.assistant {
      max-width: 94%;
    }

    .msg.system {
      color: var(--muted);
      background: color-mix(in srgb, var(--accent) 7%, var(--surface));
      border-style: dashed;
    }

    .msg.error {
      color: color-mix(in srgb, var(--danger) 88%, var(--fg));
      border-color: color-mix(in srgb, var(--danger) 48%, var(--border));
      background: color-mix(in srgb, var(--danger) 9%, var(--surface));
    }

    .msg.permission {
      border-color: color-mix(in srgb, var(--warning) 54%, var(--border));
      background: color-mix(in srgb, var(--warning) 9%, var(--surface));
    }

    .msg p { margin: 0 0 7px; }
    .msg p:last-child { margin-bottom: 0; }
    .msg code {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      background: color-mix(in srgb, var(--fg) 8%, transparent);
      border: 1px solid var(--border-soft);
      border-radius: 4px;
      padding: 1px 4px;
    }

    .code-block {
      margin: 7px 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--code);
    }

    .code-lang {
      height: 24px;
      display: flex;
      align-items: center;
      padding: 0 8px;
      color: var(--muted);
      border-bottom: 1px solid var(--border-soft);
      font-size: 10px;
    }

    pre {
      margin: 0;
      padding: 8px;
      overflow: auto;
      white-space: pre;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      line-height: 1.45;
    }

    /* === CHARGEMENT LIIX : bulle + anneau animé, sans pourcentage réel === */
    .msg.loading-message {
      display: flex;
      align-items: center;
      gap: 8px;
      border-color: color-mix(in srgb, var(--red) 26%, var(--border));
      background: color-mix(in srgb, var(--panel-2) 90%, #020407);
      transition: opacity 0.16s ease, transform 0.16s ease;
    }

    .loading {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ai-ring {
      position: relative;
      width: 20px;
      height: 20px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: conic-gradient(from 0deg, var(--blue), var(--red), var(--blue));
      animation: spin 1.05s linear infinite;
      box-shadow: 0 0 14px rgba(255, 79, 99, 0.16);
    }

    .ai-ring::after {
      content: "";
      position: absolute;
      inset: 4px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--panel-2) 92%, #020407);
    }

    .loading-text {
      min-width: 0;
      line-height: 1.35;
    }

    .loading-title {
      font-weight: 900;
      transition: opacity 0.12s ease;
    }

    .loading-title::after {
      content: "";
      animation: dots 1.2s steps(3, end) infinite;
    }

    .loading-subtitle {
      color: var(--muted);
      font-size: 11px;
      opacity: 1;
      transition: opacity 0.12s ease;
    }

    .loading-subtitle.fade {
      opacity: 0;
    }

    .step-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 7px;
    }

    .step {
      border: 1px solid var(--border-soft);
      border-radius: 999px;
      padding: 2px 6px;
      color: var(--muted);
      font-size: 10px;
    }

    .step.active {
      color: #ffd6c7;
      border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
      background: var(--accent-soft);
    }

    .step.done {
      color: var(--ok);
    }

    .typing-caret::after {
      content: "";
      display: inline-block;
      width: 7px;
      height: 1em;
      margin-left: 2px;
      border-right: 2px solid var(--red);
      vertical-align: -2px;
      animation: blink 0.8s steps(1) infinite;
    }

    .skeleton-line {
      height: 8px;
      border-radius: 999px;
      background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 7%, transparent), color-mix(in srgb, var(--accent) 18%, transparent), color-mix(in srgb, var(--accent-2) 8%, transparent));
      background-size: 220% 100%;
      animation: shimmer 1.4s ease-in-out infinite;
      margin-top: 6px;
    }

    .composer {
      display: grid;
      gap: 7px;
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--surface-2) 92%, transparent);
    }

    .composer-actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto auto;
      align-items: center;
      gap: 6px;
    }

    .queue-mini {
      min-width: 0;
      color: var(--muted);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .panel-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--surface-2) 90%, transparent);
      padding: 9px;
      margin-bottom: 8px;
    }

    .card-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 7px;
      font-size: 12px;
      font-weight: 700;
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 22px;
      border-top: 1px solid var(--border-soft);
      padding-top: 5px;
      margin-top: 5px;
    }

    .row:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }
    .label { color: var(--muted); font-size: 11px; }
    .value { font-size: 11px; text-align: right; overflow-wrap: anywhere; }
    .badge {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 1px 6px;
      color: var(--muted);
      font-size: 10px;
      min-height: 18px;
    }
    .badge.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); }
    .badge.warn { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 40%, var(--border)); }
    .badge.high { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 44%, var(--border)); }

    .action-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }

    .terminal {
      height: 100%;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr) auto;
      gap: 8px;
      min-height: 0;
    }

    .terminal-lanes {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }

    .lane {
      border: 1px solid var(--border-soft);
      border-radius: 8px;
      padding: 7px;
      background: color-mix(in srgb, var(--surface-2) 72%, transparent);
      min-height: 52px;
    }

    .terminal-output {
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px;
      background: var(--code);
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      line-height: 1.45;
    }

    .term-line {
      white-space: pre-wrap;
      word-break: break-word;
      padding: 2px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border-soft) 45%, transparent);
    }

    .stdout { color: var(--fg); }
    .stderr { color: var(--danger); }
    .command { color: #ffc2ad; }

    .settings-layout {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr);
      gap: 10px;
      min-height: 0;
    }

    .settings-nav {
      display: grid;
      align-content: start;
      gap: 4px;
      position: sticky;
      top: 0;
    }

    .settings-nav button {
      text-align: left;
      background: transparent;
      border-color: transparent;
      color: var(--muted);
    }

    .settings-nav button.active {
      color: var(--fg);
      background: color-mix(in srgb, var(--fg) 7%, transparent);
      border-color: var(--border-soft);
    }

    .settings-section { display: none; }
    .settings-section.active { display: block; }
    .field { display: grid; gap: 4px; margin-top: 7px; }
    .field input, .field select { width: 100%; }

    .permission-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      margin-top: 8px;
    }

    .toast {
      display: none;
      position: fixed;
      left: 64px;
      right: 12px;
      bottom: 42px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-2);
      box-shadow: 0 12px 40px color-mix(in srgb, #000 34%, transparent);
      z-index: 4;
    }

    .footer {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      border-top: 1px solid var(--border);
      padding: 5px 12px;
      color: var(--muted);
      font-size: 10px;
      min-height: 28px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes blink {
      0%, 45% { opacity: 1; }
      46%, 100% { opacity: 0; }
    }

    @keyframes dots {
      0% { content: "."; }
      33% { content: ".."; }
      66%, 100% { content: "..."; }
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--warning) 36%, transparent); }
      50% { box-shadow: 0 0 0 5px transparent; }
    }
    @keyframes shimmer {
      0% { background-position: 120% 0; }
      100% { background-position: -120% 0; }
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 620px) {
      .app { grid-template-columns: 44px minmax(0, 1fr); }
      .rail { padding-inline: 4px; }
      .nav-btn { width: 32px; }
      .topbar-inner { grid-template-columns: minmax(0, 1fr); padding: 6px 8px; }
      .header-controls { justify-content: space-between; }
      .model-select { width: 100%; max-width: none; }
      .page { padding: 8px; }
      .compact-strip, .composer-actions, .settings-layout, .panel-grid, .terminal-lanes {
        grid-template-columns: 1fr;
      }
      .msg.user, .msg.assistant { max-width: 100%; }
      .action-grid { grid-template-columns: 1fr; }
      .toast { left: 52px; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="rail" aria-label="Liix AI navigation">
      <div class="mark">L</div>
      <button class="nav-btn active" data-page="chat" title="Chat"><span class="nav-icon">C</span></button>
      <button class="nav-btn" data-page="agent" title="Agent"><span class="nav-icon">A</span></button>
      <button class="nav-btn" data-page="terminal" title="Terminal"><span class="nav-icon">&gt;</span></button>
      <button class="nav-btn" data-page="settings" title="Settings"><span class="nav-icon">S</span></button>
      <button class="nav-btn" data-page="account" title="Account"><span class="nav-icon">@</span></button>
    </aside>

    <div class="shell">
      <header class="topbar">
        <div class="topbar-inner">
          <div>
            <div class="title-row">
              <span class="title">Liix AI</span>
              <span class="badge">v0.2.x</span>
              <span class="badge" id="connectionBadge">${escapeHtml(defaultProvider)}</span>
            </div>
            <div class="meta-row">
              <span id="agentDot" class="status-dot"></span>
              <span id="agentLabel">Prêt</span>
              <span>·</span>
              <span id="workspaceLabel" class="truncate">${escapeHtml(workspace)}</span>
              <span>·</span>
              <span id="runtimeMini">runtime: inspection</span>
            </div>
          </div>
          <div class="header-controls">
            <select id="model" class="model-select" title="Modèle actif">${modelOptions}</select>
            <button id="refreshRuntime" class="ghost" title="Rafraîchir runtime">↻</button>
          </div>
        </div>
      </header>

      <main class="main">
        <section id="chat" class="page chat-page active">
          <div class="compact-strip">
            <div class="mode-pills" aria-label="Mode agent">
              <button class="mode-pill active" data-mode="chat" title="Conversation seulement">Chat</button>
              <button class="mode-pill" data-mode="agent" title="Lecture, écriture avec permission, erreurs, git read, terminal limité">Agent</button>
              <button class="mode-pill" data-mode="full" title="Accès complet avec confirmations">Full</button>
            </div>
            <div class="runtime-card">
              <span id="runtimeState">idle</span>
              <span id="tokenMini">tokens: --</span>
            </div>
          </div>

          <div id="messages" class="messages">
            <div class="msg system">
              <strong>Liix agent réel prêt.</strong>
              <p>Commandes disponibles: /project, /errors, /read chemin, /write chemin, /delete chemin, /run commande, /git status.</p>
            </div>
          </div>

          <div class="composer">
            <textarea id="prompt" placeholder="Demande une analyse, ou lance /project, /errors, /read Src/main.c, /run npm test"></textarea>
            <div class="composer-actions">
              <div id="queueLabel" class="queue-mini">Queue vide</div>
              <button id="readFile" class="ghost">Fichier actif</button>
              <button id="stop" class="danger" style="display:none;">Stop</button>
              <button id="send" class="primary">Envoyer</button>
            </div>
          </div>
        </section>

        <section id="agent" class="page">
          <div class="panel-grid">
            <div class="card">
              <div class="card-title">Modes agent <span id="agentModeBadge" class="badge">Chat</span></div>
              <div class="row"><span class="label">Chat</span><span class="value">conversation, aucun write/run</span></div>
              <div class="row"><span class="label">Agent</span><span class="value">outils projet avec permissions</span></div>
              <div class="row"><span class="label">Full</span><span class="value">terminal et git complets avec garde-fous</span></div>
            </div>
            <div class="card">
              <div class="card-title">États visuels <span id="stateBadge" class="badge ok">idle</span></div>
              <div class="row"><span class="label">Analyse</span><span class="value">Analyse de la demande...</span></div>
              <div class="row"><span class="label">Contexte</span><span class="value">Lecture workspace...</span></div>
              <div class="row"><span class="label">Outil</span><span class="value">Exécution commande...</span></div>
            </div>
          </div>
          <div id="permissionBox"></div>
          <div class="card">
            <div class="card-title">Actions rapides</div>
            <div class="action-grid">
              <button data-action="project">Analyser projet</button>
              <button data-action="errors">Analyser erreurs</button>
              <button data-action="gitStatus">git status</button>
              <button data-action="gitDiff">git diff</button>
            </div>
          </div>
          <div class="card">
            <div class="card-title">Capacités réelles</div>
            <div class="row"><span class="label">/read</span><span class="badge ok">actif</span></div>
            <div class="row"><span class="label">/write /delete</span><span class="badge warn">permission</span></div>
            <div class="row"><span class="label">/run</span><span class="badge warn">permission</span></div>
            <div class="row"><span class="label">/git</span><span class="badge warn">read/permission</span></div>
          </div>
        </section>

        <section id="terminal" class="page">
          <div class="terminal">
            <div class="compact-strip">
              <div>
                <div class="title">Terminal Liix</div>
                <div class="label">stdout/stderr réels, historique, queue et retry.</div>
              </div>
              <button id="clearTerminal" class="ghost">Clear</button>
            </div>
            <div class="terminal-lanes">
              <div class="lane"><div class="label">Queue</div><div id="terminalQueue" class="value">vide</div></div>
              <div class="lane"><div class="label">Récentes</div><div id="recentCommands" class="value">--</div></div>
              <div class="lane"><div class="label">Dernier état</div><div id="terminalState" class="value">prêt</div></div>
            </div>
            <div id="terminalOutput" class="terminal-output">
              <div class="term-line stdout">Terminal Liix prêt.</div>
            </div>
            <div class="composer-actions">
              <input id="terminalCommand" placeholder="/run cmake --build build/qc1 ou /git status" />
              <button id="retryCommand" class="ghost">Retry</button>
              <button id="runTerminal" class="primary">Run</button>
            </div>
          </div>
        </section>

        <section id="settings" class="page">
          ${settingsHtml(defaultModel)}
        </section>

        <section id="account" class="page">
          <div class="panel-grid">
            <div class="card">
              <div class="card-title">Account / Profile</div>
              <div class="row"><span class="label">Nom</span><span id="accountName" class="value">Utilisateur Liix</span></div>
              <div class="row"><span class="label">Email / provider</span><span id="accountEmail" class="value">--</span></div>
              <div class="row"><span class="label">Modèle actif</span><span id="accountModel" class="value">${escapeHtml(defaultModel)}</span></div>
              <div class="row"><span class="label">Provider actif</span><span id="accountProvider" class="value">${escapeHtml(defaultProvider)}</span></div>
              <div class="row"><span class="label">Mode</span><span id="accountMode" class="value">cloud</span></div>
              <div class="row"><span class="label">Abonnement</span><span id="accountSub" class="value">Developer</span></div>
              <div class="row"><span class="label">API Key</span><span id="apiKeyMasked" class="value">sk-****-****-none</span></div>
              <button id="copyApiKey" class="ghost">Copier API Key</button>
            </div>
            <div class="card">
              <div class="card-title">Usage and Billing</div>
              <div id="usageBox">
                <div class="row"><span class="label">Usage</span><span class="value">Aucune requête encore.</span></div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <div id="toast" class="toast"></div>
      <footer class="footer">
        <span id="runtimeLine" class="truncate">Runtime: inspection en cours</span>
        <span id="usageLine">tokens: --</span>
      </footer>
    </div>
  </div>

  <script>
    // Pont vers LiixAiPanelProvider. Les variables suivantes vivent seulement dans la page.
    const vscode = acquireVsCodeApi();
    let mode = "chat";
    let promptQueue = [];
    let busy = false;
    let activeRequestId = "";
    let cancelledRequests = new Set();
    let lastTerminalCommand = "";
    let recentCommands = [];
    let lastErrorPrompt = "";
    let runtimeState = {
      provider: "${escapeJs(defaultProvider)}",
      mode: "${escapeJs(defaultProvider === "local" ? "local" : "cloud")}",
      endpoint: "",
      model: "${escapeJs(defaultModel)}",
      models: []
    };
    // Un timer par requête fait alterner les sous-titres du loader.
    let loadingTimers = new Map();

    const stateLabels = {
      idle: "Prêt",
      queued: "En file...",
      analyzing: "Analyse de la demande...",
      reading_context: "Lecture du contexte workspace...",
      running_tool: "Exécution de la commande...",
      streaming: "Réponse en cours...",
      waiting_permission: "Permission requise",
      error: "Erreur",
      done: "Terminé"
    };

    const waitingStates = [
      "Liix reflechit...",
      "Liix analyse...",
      "Liix ecrit...",
    ];

    const stepOrder = ["queued", "analyzing", "reading_context", "running_tool", "streaming", "done"];
    const $ = (id) => document.getElementById(id);

    document.querySelectorAll(".nav-btn").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".nav-btn").forEach((item) => item.classList.remove("active"));
        document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
        button.classList.add("active");
        $(button.dataset.page).classList.add("active");
      });
    });

    document.querySelectorAll(".mode-pill").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".mode-pill").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        mode = button.dataset.mode;
        $("agentModeBadge").textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
      });
    });

    document.querySelectorAll(".settings-nav button").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".settings-nav button").forEach((item) => item.classList.remove("active"));
        document.querySelectorAll(".settings-section").forEach((section) => section.classList.remove("active"));
        button.classList.add("active");
        $(button.dataset.settings).classList.add("active");
      });
    });

    $("send").addEventListener("click", queuePrompt);
    $("prompt").addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") queuePrompt();
    });
    $("stop").addEventListener("click", stopGeneration);
    $("readFile").addEventListener("click", () => startDirectRequest("Lecture fichier actif", { type: "readActiveFile", modelId: $("model").value }));
    $("refreshRuntime").addEventListener("click", () => vscode.postMessage({ type: "refreshRuntime" }));
    $("model").addEventListener("change", () => vscode.postMessage({ type: "selectModel", modelId: $("model").value }));
    $("clearTerminal").addEventListener("click", () => { $("terminalOutput").innerHTML = '<div class="term-line stdout">Terminal Liix prêt.</div>'; });
    $("runTerminal").addEventListener("click", runTerminalCommand);
    $("retryCommand").addEventListener("click", retryLast);
    $("copyApiKey").addEventListener("click", () => vscode.postMessage({ type: "copyApiKey" }));
    $("refreshModels").addEventListener("click", () => vscode.postMessage({ type: "refreshModels" }));
    $("runtimeProvider").addEventListener("change", saveRuntimeSettings);
    $("runtimeLocalApiType").addEventListener("change", saveRuntimeSettings);
    $("runtimeLocalEndpoint").addEventListener("change", saveRuntimeSettings);
    $("runtimeDefaultModel").addEventListener("change", saveRuntimeSettings);

    document.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.action;
        if (action === "project") startDirectRequest("Analyser projet", { type: "runQuickAction", mode, action: { kind: "project" } });
        if (action === "errors") startDirectRequest("Analyser erreurs", { type: "runQuickAction", mode, action: { kind: "errors" } });
        if (action === "gitStatus") startDirectRequest("git status", { type: "runQuickAction", mode, action: { kind: "git", command: "git status" } });
        if (action === "gitDiff") startDirectRequest("git diff", { type: "runQuickAction", mode, action: { kind: "git", command: "git diff" } });
      });
    });

    // Ajoute une demande à la file; une seule requête est active à la fois.
    function queuePrompt() {
      const text = $("prompt").value.trim();
      if (!text) return;
      $("prompt").value = "";
      promptQueue.push({ text, requestId: makeRequestId() });
      updateQueue();
      dispatchQueue();
    }

    // Prend le prochain élément et l'envoie au provider TypeScript.
    function dispatchQueue() {
      if (busy || promptQueue.length === 0) return;
      const item = promptQueue.shift();
      busy = true;
      activeRequestId = item.requestId;
      setBusyUi(true);
      updateQueue();
      setAgentStatus("queued", stateLabels.queued, item.requestId);

      if (item.directPayload) {
        item.directPayload.requestId = item.requestId;
        vscode.postMessage(item.directPayload);
        return;
      }

      lastErrorPrompt = item.text;
      vscode.postMessage({ type: "sendMessage", requestId: item.requestId, modelId: $("model").value, message: item.text, mode });
    }

    function startDirectRequest(label, payload) {
      if (busy) {
        promptQueue.push({ text: label, requestId: makeRequestId(), directPayload: payload });
        updateQueue();
        return;
      }

      const requestId = makeRequestId();
      busy = true;
      activeRequestId = requestId;
      setBusyUi(true);
      setAgentStatus("queued", stateLabels.queued, requestId);
      payload.requestId = requestId;
      vscode.postMessage(payload);
    }

    function stopGeneration() {
      if (!activeRequestId) return;
      cancelledRequests.add(activeRequestId);
      removeLoading(activeRequestId);
      appendSystem("Génération arrêtée côté interface. La commande backend peut finir en arrière-plan.");
      finishRequest(activeRequestId, "idle");
    }

    function runTerminalCommand() {
      const raw = $("terminalCommand").value.trim();
      if (!raw) return;
      lastTerminalCommand = raw;
      rememberCommand(raw);
      $("terminalCommand").value = "";
      $("terminalQueue").textContent = raw;
      if (raw.startsWith("/git ")) {
        startDirectRequest(raw, { type: "runQuickAction", mode: "full", action: { kind: "git", command: "git " + raw.slice(5) } });
      } else {
        startDirectRequest(raw, { type: "runQuickAction", mode: "full", action: { kind: "terminal", command: raw.replace(/^\\/run\\s+/, "") } });
      }
    }

    function retryLast() {
      if (lastTerminalCommand) {
        $("terminalCommand").value = lastTerminalCommand;
        runTerminalCommand();
        return;
      }

      if (lastErrorPrompt) {
        $("prompt").value = lastErrorPrompt;
        queuePrompt();
      }
    }

    function appendMessage(kind, content, requestId, streaming) {
      const div = document.createElement("div");
      div.className = "msg " + kind;
      if (requestId) div.dataset.requestId = requestId;
      $("messages").appendChild(div);
      $("messages").scrollTop = $("messages").scrollHeight;

      if (streaming) {
        typeText(div, content, () => {
          div.innerHTML = renderMarkdown(content);
          finishRequest(requestId, "done");
        }, requestId);
        return div;
      }

      div.innerHTML = renderMarkdown(content);
      return div;
    }

    function appendSystem(content, variant) {
      const div = appendMessage(variant || "system", content);
      div.classList.add(variant || "system");
    }

    function showLoading(requestId, state, label) {
      startLoadingBubble(requestId, state, label);
    }

    /**
     * Crée l'animation d'attente Liix dans le chat.
     * Elle visualise un état (analyse, outil, réponse), mais ne mesure aucun téléchargement.
     */
    function startLoadingBubble(requestId, state, label) {
      stopLoadingBubble(requestId);
      const div = document.createElement("div");
      div.className = "msg system loading-message message assistant loading";
      div.dataset.loadingFor = requestId || "global";
      div.innerHTML =
        '<div class="loading">' +
        '<div class="ai-ring"></div>' +
        '<div class="loading-text">' +
        '<div class="loading-title"><span class="content">' + escapeHtml(label || stateLabels[state] || "Liix travaille") + '</span></div>' +
        '<div class="loading-subtitle">' + waitingStates[0] + '</div>' +
        '</div>' +
        '</div>';
      $("messages").appendChild(div);
      $("messages").scrollTop = $("messages").scrollHeight;
      startWaitingRotation(requestId || "global", div);
    }

    function stopLoadingBubble(requestId) {
      removeLoading(requestId);
    }

    // Retire le DOM et surtout son setInterval pour éviter une fuite de timers.
    function removeLoading(requestId) {
      const key = requestId || "global";
      if (loadingTimers.has(key)) {
        clearInterval(loadingTimers.get(key));
        loadingTimers.delete(key);
      }
      document.querySelectorAll('[data-loading-for="' + cssEscape(key) + '"]').forEach((node) => node.remove());
    }

    // Alterne les textes « réfléchit / analyse / écrit » toutes les 850 ms.
    function startWaitingRotation(requestId, container) {
      let index = 0;
      const subtitle = container.querySelector(".loading-subtitle");
      if (!subtitle) return;
      const timer = window.setInterval(() => {
        index = (index + 1) % waitingStates.length;
        subtitle.classList.add("fade");
        window.setTimeout(() => {
          subtitle.textContent = waitingStates[index];
          subtitle.classList.remove("fade");
          $("messages").scrollTop = $("messages").scrollHeight;
        }, 120);
      }, 850);
      loadingTimers.set(requestId, timer);
    }

    function renderSteps(state) {
      const currentIndex = stepOrder.indexOf(state);
      return stepOrder.map((step, index) => {
        const klass = index < currentIndex ? "step done" : index === currentIndex ? "step active" : "step";
        return '<span class="' + klass + '">' + escapeHtml(shortState(step)) + '</span>';
      }).join("");
    }

    function shortState(state) {
      return {
        queued: "reçu",
        analyzing: "analyse",
        reading_context: "contexte",
        running_tool: "outil",
        streaming: "réponse",
        done: "terminé"
      }[state] || state;
    }

    function typeText(target, text, done, requestId) {
      target.classList.add("typing-caret");
      const chunks = text.match(/\\S+\\s*|\\n+/g) || [text];
      let index = 0;

      function writeNextChunk() {
        if (requestId && cancelledRequests.has(requestId)) {
          target.classList.remove("typing-caret");
          target.remove();
          if (done) done();
          return;
        }

        if (index >= chunks.length) {
          target.classList.remove("typing-caret");
          if (done) done();
          return;
        }

        target.textContent += chunks[index];
        index += 1;
        $("messages").scrollTop = $("messages").scrollHeight;

        const delay = chunks[index - 1].includes("\\n") ? 42 : 22 + Math.floor(Math.random() * 28);
        window.setTimeout(writeNextChunk, delay);
      }

      writeNextChunk();
    }

    function appendTerminal(content, stream) {
      const div = document.createElement("div");
      div.className = "term-line " + (stream || "stdout");
      div.textContent = content;
      $("terminalOutput").appendChild(div);
      $("terminalOutput").scrollTop = $("terminalOutput").scrollHeight;
      $("terminalState").textContent = stream === "stderr" ? "stderr" : stream === "command" ? "commande" : "stdout";
      if (stream === "command") {
        $("terminalQueue").textContent = content;
      }
    }

    function showPermission(request, requestId) {
      const box = $("permissionBox");
      box.innerHTML = "";
      const div = document.createElement("div");
      div.className = "card permission";
      div.innerHTML =
        '<div class="card-title">Permission requise <span class="badge high">' + escapeHtml(request.risk) + '</span></div>' +
        '<div class="row"><span class="label">Action</span><span class="value">' + escapeHtml(request.action) + '</span></div>' +
        '<div class="row"><span class="label">Commande</span><span class="value">' + escapeHtml(request.command || "--") + '</span></div>' +
        '<div class="row"><span class="label">Workspace</span><span class="value">' + escapeHtml(request.workspace) + '</span></div>' +
        '<div class="row"><span class="label">Fichiers</span><span class="value">' + escapeHtml((request.files || []).join(", ") || "--") + '</span></div>' +
        '<div class="permission-actions">' +
        '<button data-decision="allowOnce">Allow once</button>' +
        '<button data-decision="allowSession">Allow session</button>' +
        '<button data-decision="alwaysAllow">Always allow</button>' +
        '<button class="danger" data-decision="deny">Deny</button>' +
        '</div>';
      box.appendChild(div);
      appendMessage("permission", "Permission requise pour " + request.action + ". Ouvre l'onglet Agent pour décider.", requestId);
      div.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
          vscode.postMessage({ type: "permissionDecision", requestId: request.id, decision: button.dataset.decision });
          box.innerHTML = "";
        });
      });
      document.querySelector('[data-page="agent"]').click();
    }

    /** Point central qui montre le loader pour les états occupés et le retire à la fin. */
    function setAgentStatus(state, label, requestId) {
      const normalized = state || "idle";
      $("agentDot").className = "status-dot " + normalized + (isBusyState(normalized) ? " active" : "");
      $("agentLabel").textContent = label || stateLabels[normalized] || normalized;
      $("runtimeState").textContent = normalized;
      $("stateBadge").textContent = normalized;
      $("stateBadge").className = "badge " + (normalized === "error" ? "high" : normalized === "done" || normalized === "idle" ? "ok" : "warn");
      if (isBusyState(normalized)) {
        showLoading(requestId || activeRequestId, normalized, label);
      } else if (normalized === "done" || normalized === "idle") {
        removeLoading(requestId || activeRequestId);
      }
    }

    function isBusyState(state) {
      return ["queued", "analyzing", "reading_context", "running_tool", "streaming", "waiting_permission"].includes(state);
    }

    function finishRequest(requestId, state) {
      removeLoading(requestId);
      if (!requestId || requestId === activeRequestId) {
        busy = false;
        activeRequestId = "";
        setBusyUi(false);
        setAgentStatus(state || "done", stateLabels[state || "done"], requestId);
        updateQueue();
        dispatchQueue();
      }
    }

    function setBusyUi(isBusy) {
      $("stop").style.display = isBusy ? "inline-block" : "none";
      $("send").disabled = false;
    }

    function updateQueue() {
      if (!promptQueue.length) {
        $("queueLabel").textContent = busy ? "Queue: génération en cours" : "Queue vide";
        return;
      }
      $("queueLabel").textContent = "Queue: " + promptQueue.length + " · " + promptQueue.map((item) => item.text).join(" / ");
    }

    function rememberCommand(command) {
      recentCommands = [command].concat(recentCommands.filter((item) => item !== command)).slice(0, 4);
      $("recentCommands").textContent = recentCommands.join(" · ");
    }

    function setRuntime(runtime) {
      runtimeState = {
        provider: runtime.activeProvider || runtime.provider,
        mode: runtime.activeMode || (runtime.localMode ? "local" : "cloud"),
        endpoint: runtime.activeEndpoint || runtime.localApiUrl || "",
        model: runtime.activeModel || runtime.localModel || $("model").value,
        models: runtime.models || []
      };
      syncModelDropdown(runtimeState.models, runtimeState.model);
      $("runtimeLine").textContent = "Runtime: " + runtimeState.mode + " · " + runtimeState.endpoint + " · git " + (runtime.gitAvailable ? "OK" : "--");
      $("runtimeMini").textContent = runtime.localMode ? runtime.localApiType + " · " + runtimeState.model : "cloud · API";
      $("workspaceLabel").textContent = runtime.workspace;
      $("connectionBadge").textContent = runtimeState.mode;
      $("accountName").textContent = runtime.account.name;
      $("accountEmail").textContent = runtime.account.email || "--";
      $("accountProvider").textContent = runtimeState.provider;
      $("accountMode").textContent = runtimeState.mode;
      $("accountSub").textContent = runtime.account.subscription;
      $("accountModel").textContent = runtimeState.model;
      $("apiKeyMasked").textContent = runtime.apiKeyMasked;
      $("runtimeProvider").value = runtimeState.provider;
      $("runtimeLocalApiType").value = runtime.localApiType;
      $("runtimeLocalEndpoint").value = runtime.localApiUrl || "";
      $("runtimeDefaultModel").value = runtimeState.model;
      $("settingsRuntimeSummary").textContent = runtimeState.mode + " · " + runtimeState.endpoint + " · " + runtimeState.model;
      $("usageModeLine").textContent = runtime.localMode ? "Unlimited local usage" : "Usage API cloud";
    }

    function syncModelDropdown(models, activeModel) {
      const select = $("model");
      const current = activeModel || select.value;
      select.innerHTML = "";
      (models.length ? models : [{ id: current, label: current }]).forEach((model) => {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.label || model.id;
        select.appendChild(option);
      });
      select.value = current;
      $("runtimeDefaultModel").value = current;
      $("modelCount").textContent = String(models.length || 1);
    }

    function saveRuntimeSettings() {
      const provider = $("runtimeProvider").value;
      const localApiType = $("runtimeLocalApiType").value;
      const selectedModel = $("runtimeDefaultModel").value || $("model").value;
      vscode.postMessage({
        type: "settingsChanged",
        provider,
        localApiType,
        localApiUrl: $("runtimeLocalEndpoint").value,
        localModel: provider === "local" ? selectedModel : undefined,
        defaultModel: provider === "liix" ? selectedModel : undefined
      });
    }

    function setUsage(usage) {
      $("usageLine").textContent = "tokens: " + usage.totalTokens + " · " + usage.provider;
      $("tokenMini").textContent = "tokens: " + usage.totalTokens;
      $("accountModel").textContent = usage.model;
      $("usageBox").innerHTML =
        '<div class="row"><span class="label">Modèle</span><span class="value">' + escapeHtml(usage.model) + '</span></div>' +
        '<div class="row"><span class="label">Provider</span><span class="value">' + escapeHtml(usage.local ? "local" : usage.provider) + '</span></div>' +
        '<div class="row"><span class="label">Prompt</span><span class="value">' + usage.promptTokens + '</span></div>' +
        '<div class="row"><span class="label">Réponse</span><span class="value">' + usage.responseTokens + '</span></div>' +
        '<div class="row"><span class="label">Total tokens</span><span class="value">' + usage.totalTokens + '</span></div>' +
        '<div class="row"><span class="label">Coûts / limite</span><span class="value">' + escapeHtml(usage.cost) + '</span></div>' +
        '<div class="row"><span class="label">Vitesse</span><span class="value">' + escapeHtml(usage.latency) + '</span></div>';
    }

    function showToast(content) {
      $("toast").textContent = content;
      $("toast").style.display = "block";
      setTimeout(() => { $("toast").style.display = "none"; }, 1800);
    }

    function renderMarkdown(text) {
      const fence = String.fromCharCode(96, 96, 96);
      const parts = String(text).split(fence);
      return parts.map((part, index) => {
        if (index % 2 === 1) {
          const lines = part.replace(/^\\n/, "").split("\\n");
          const lang = lines[0] && /^[a-z0-9_+#.-]+$/i.test(lines[0]) ? lines.shift() : "code";
          return '<div class="code-block"><div class="code-lang">' + escapeHtml(lang || "code") + '</div><pre><code>' + escapeHtml(lines.join("\\n")) + '</code></pre></div>';
        }

        return part
          .split(/\\n{2,}/)
          .filter(Boolean)
          .map((paragraph) => '<p>' + escapeInlineMarkdown(paragraph).replace(/\\n/g, "<br>") + '</p>')
          .join("");
      }).join("");
    }

    function escapeInlineMarkdown(value) {
      const tick = String.fromCharCode(96);
      return escapeHtml(value)
        .replace(new RegExp(tick + "([^" + tick + "]+)" + tick, "g"), "<code>$1</code>")
        .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    function cssEscape(value) {
      if (window.CSS && CSS.escape) return CSS.escape(value);
      return String(value).replace(/"/g, "\\\\22 ");
    }

    function makeRequestId() {
      return String(Date.now()) + "-" + Math.random().toString(16).slice(2);
    }

    // Routeur extension -> page. Les types correspondent aux méthodes post...() plus haut.
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.requestId && cancelledRequests.has(msg.requestId) && msg.type !== "agentStatus") return;
      if (msg.type === "userMessage") appendMessage("user", msg.content, msg.requestId);
      if (msg.type === "assistantMessage") {
        removeLoading(msg.requestId || activeRequestId);
        appendMessage("assistant", msg.content, msg.requestId || activeRequestId, true);
      }
      if (msg.type === "errorMessage") {
        appendMessage("error", msg.content, msg.requestId || activeRequestId);
        finishRequest(msg.requestId || activeRequestId, "error");
      }
      if (msg.type === "permissionRequest") showPermission(msg.request, msg.requestId);
      if (msg.type === "terminalEvent") appendTerminal(msg.content, msg.stream);
      if (msg.type === "agentStatus") setAgentStatus(msg.state, msg.label, msg.requestId);
      if (msg.type === "toast") showToast(msg.content);
      if (msg.type === "usage") setUsage(msg.usage);
      if (msg.type === "runtime") setRuntime(msg.runtime);
      if (msg.type === "systemMessage") appendSystem(msg.content);
    });
  </script>
</body>
</html>`;
    }
}
exports.LiixAiPanelProvider = LiixAiPanelProvider;
LiixAiPanelProvider.viewType = "liixAiChat";
function buildPrompt(text, mode, toolContext) {
    return [
        `Mode Liix: ${mode.toUpperCase()}`,
        "Réponds comme un assistant de code VS Code. Si un résultat outil est fourni, base-toi dessus.",
        toolContext ? `\nContexte outil:\n${toolContext}` : "",
        `\nDemande utilisateur:\n${text}`
    ].join("\n");
}
function createPermissionKey(action) {
    return `${action.kind}:${action.command || ""}:${action.filePath || ""}`;
}
function formatAgentResult(result) {
    return [
        `[Liix] ${result.title}`,
        result.summary,
        "",
        result.details
    ].join("\n");
}
function estimateTokens(text) {
    return Math.max(1, Math.ceil(text.length / 4));
}
function getRuntimeModelLabel(modelId) {
    if ((0, aiClient_1.getLiixProvider)() === "local") {
        return modelId || (0, aiClient_1.getLiixLocalModel)();
    }
    return (0, aiModels_1.getAiModelLabel)(modelId);
}
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    }[char] || char));
}
function escapeJs(value) {
    return value.replace(/[\\"]/g, (char) => `\\${char}`);
}
function settingsHtml(defaultModel) {
    return `
    <div class="settings-layout">
      <div class="settings-nav">
        <button class="active" data-settings="settings-general">General</button>
        <button data-settings="settings-models">Models</button>
        <button data-settings="settings-permissions">Permissions</button>
        <button data-settings="settings-plugins">Plugins</button>
        <button data-settings="settings-usage">Usage</button>
      </div>
      <div>
        <div id="settings-general" class="settings-section active">
          <div class="card"><div class="card-title">General</div>
            <div class="field"><span class="label">Langue</span><select><option>Français</option><option>English</option></select></div>
            <div class="field"><span class="label">Thème</span><select><option>Dark VS Code</option><option>System</option></select></div>
            <div class="row"><span class="label">Raccourcis clavier</span><span class="badge ok">Cmd/Ctrl+Enter</span></div>
            <div class="row"><span class="label">Auto-save prompts</span><span class="badge ok">On</span></div>
            <div class="row"><span class="label">Telemetry</span><span class="badge">Off</span></div>
            <div class="row"><span class="label">Animations UI</span><span class="badge ok">On</span></div>
          </div>
        </div>
        <div id="settings-models" class="settings-section">
          <div class="card"><div class="card-title">Models / Runtime <button id="refreshModels" class="ghost">Refresh models</button></div>
            <div class="field"><span class="label">Provider actif</span><select id="runtimeProvider"><option value="liix">Liix Cloud</option><option value="local">Local</option></select></div>
            <div class="field"><span class="label">Runtime local</span><select id="runtimeLocalApiType"><option value="ollama">Ollama</option><option value="openai-compatible">LM Studio / OpenAI-compatible</option></select></div>
            <div class="field"><span class="label">Endpoint local</span><input id="runtimeLocalEndpoint" value="${escapeHtml((0, aiClient_1.getLiixLocalApiUrl)())}" /></div>
            <div class="field"><span class="label">Modèle actif</span><input id="runtimeDefaultModel" value="${escapeHtml(defaultModel)}" /></div>
            <div class="row"><span class="label">Source actuelle</span><span id="settingsRuntimeSummary" class="value">${escapeHtml((0, aiClient_1.getLiixProvider)())} · ${escapeHtml((0, aiClient_1.getLiixLocalApiType)())} · ${escapeHtml((0, aiClient_1.getLiixLocalModel)())}</span></div>
            <div class="row"><span class="label">Modèles disponibles</span><span id="modelCount" class="value">--</span></div>
            <div class="row"><span class="label">Timeout IA</span><span class="value">120s</span></div>
            <div class="row"><span class="label">Max tokens</span><span class="value">4096</span></div>
            <div class="row"><span class="label">Température</span><span class="value">0.2</span></div>
          </div>
        </div>
        <div id="settings-permissions" class="settings-section">
          <div class="card"><div class="card-title">Permissions</div>
            <div class="row"><span class="label">Terminal</span><span class="badge warn">ask</span></div>
            <div class="row"><span class="label">Fichiers</span><span class="badge warn">ask</span></div>
            <div class="row"><span class="label">Git</span><span class="badge warn">read/ask</span></div>
            <div class="row"><span class="label">Mode Chat</span><span class="value">aucune écriture</span></div>
            <div class="row"><span class="label">Mode Agent</span><span class="value">outils limités</span></div>
            <div class="row"><span class="label">Mode Full</span><span class="value">confirmations visibles</span></div>
          </div>
        </div>
        <div id="settings-plugins" class="settings-section">
          <div class="card"><div class="card-title">Plugins and Add-ons</div>
            <div class="row"><span class="label">Filesystem</span><span class="badge ok">installé</span></div>
            <div class="row"><span class="label">Git</span><span class="badge ok">installé</span></div>
            <div class="row"><span class="label">Terminal</span><span class="badge ok">installé</span></div>
            <div class="row"><span class="label">RAG</span><span class="badge">placeholder</span></div>
            <div class="row"><span class="label">Local models</span><span class="badge ok">Ollama / LM Studio</span></div>
          </div>
        </div>
        <div id="settings-usage" class="settings-section">
          <div class="card"><div class="card-title">Usage and Billing</div>
            <div class="row"><span class="label">Mode actif</span><span id="usageModeLine" class="badge ok">Unlimited local usage</span></div>
            <div class="row"><span class="label">Cloud</span><span class="value">selon provider</span></div>
            <div class="row"><span class="label">Contexte max</span><span class="value">workspace + actif</span></div>
            <div class="row"><span class="label">Dossier workspace</span><span class="value">${escapeHtml((0, aiAgent_1.getWorkspaceRoot)() || "--")}</span></div>
          </div>
        </div>
      </div>
    </div>
  `;
}
//# sourceMappingURL=aiPanel.js.map