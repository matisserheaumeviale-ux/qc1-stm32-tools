"use strict";
/**
 * RÉSUMÉ — PONT ENTRE VS CODE, L'AGENT LIIX ET LA WEBVIEW
 *
 * Ce provider ne contient plus le CSS ni la boucle agentique. Il valide les messages
 * de la Webview, prépare les contextes explicitement joints, transmet les événements
 * du LiixAgentController et résout les demandes de permission inline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiixAiPanelProvider = void 0;
const child_process_1 = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const aiClient_1 = require("./aiClient");
const aiAgent_1 = require("./aiAgent");
const aiAgentController_1 = require("./aiAgentController");
const aiContext_1 = require("./aiContext");
const aiErrorParser_1 = require("./aiErrorParser");
const aiWebviewHtml_1 = require("./aiWebviewHtml");
class LiixAiPanelProvider {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this.pendingPermissions = new Map();
        this.lastTerminalOutput = "";
        this.controller = new aiAgentController_1.LiixAgentController((event) => this.handleControllerEvent(event), (request, call, signal) => this.requestPermission(request, call, signal));
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
        webviewView.webview.html = (0, aiWebviewHtml_1.getLiixWebviewHtml)({
            nonce: crypto.randomBytes(18).toString("base64"),
            provider: (0, aiClient_1.getLiixProvider)(),
            model: (0, aiClient_1.getActiveLiixModel)(),
            workspace: (0, aiAgent_1.getWorkspaceRoot)() || "Aucun workspace",
            localApiUrl: (0, aiClient_1.getLiixLocalApiUrl)(),
            localApiType: (0, aiClient_1.getLiixLocalApiType)(),
            toolCallingMode: vscode.workspace.getConfiguration().get("liix.supportsToolCalling", "auto")
        });
        webviewView.webview.onDidReceiveMessage((message) => void this.routeMessage(message));
        webviewView.onDidDispose(() => {
            this.controller.cancel();
            this.rejectPendingPermissions("Webview fermée.");
            this.view = undefined;
        });
        void this.postRuntimeState();
    }
    /** Méthodes publiques utilisées par les commandes de la palette VS Code. */
    newChat() {
        this.controller.newChat();
        this.post({ type: "newChat" });
    }
    stop() {
        this.controller.cancel();
    }
    async undoLastEdit() {
        this.postToast(await this.controller.undoLastEdit());
    }
    async openLastDiff() {
        try {
            await this.controller.openLastDiff();
        }
        catch (error) {
            this.postToast(error instanceof Error ? error.message : String(error));
        }
    }
    async refreshModels() {
        await this.postRuntimeState();
    }
    requestPrompt(prompt, mode = "agent") {
        this.post({ type: "externalPrompt", prompt, mode });
    }
    showPage(page) {
        this.post({ type: "navigate", page });
    }
    dispose() {
        this.rejectPendingPermissions("Extension désactivée.");
        this.controller.dispose();
    }
    async routeMessage(message) {
        try {
            switch (message.type) {
                case "sendMessage":
                    await this.handleSendMessage(message);
                    break;
                case "runTerminal":
                    await this.handleTerminal(message);
                    break;
                case "cancel":
                    this.controller.cancel();
                    break;
                case "newChat":
                    this.newChat();
                    break;
                case "permissionDecision":
                    this.resolvePermission(message.permissionId, message.decision);
                    break;
                case "contextRequest":
                    await this.addContext(message.contextType);
                    break;
                case "copyText":
                    await vscode.env.clipboard.writeText(message.content || "");
                    this.postToast("Copié.");
                    break;
                case "refreshModels":
                    await this.postRuntimeState();
                    break;
                case "testConnection":
                    this.post({ type: "connectionTest", result: await (0, aiClient_1.testLiixConnection)() });
                    break;
                case "selectModel":
                    if (message.modelId) {
                        await (0, aiClient_1.setActiveLiixModel)(message.modelId);
                        await this.postRuntimeState();
                    }
                    break;
                case "undoLastEdit":
                    await this.undoLastEdit();
                    break;
                case "openLastDiff":
                    await this.openLastDiff();
                    break;
                case "settingsChanged":
                    await (0, aiClient_1.updateLiixRuntimeConfig)(message);
                    await this.postRuntimeState();
                    this.postToast("Runtime Liix enregistré.");
                    break;
            }
        }
        catch (error) {
            this.post({ type: "errorMessage", content: error instanceof Error ? error.message : String(error) });
            if ("requestId" in message && typeof message.requestId === "string")
                this.post({ type: "requestDone", requestId: message.requestId });
        }
    }
    async handleSendMessage(message) {
        const prompt = (message.message || "").trim();
        if (!prompt)
            throw new Error("Écris un message avant d'envoyer.");
        const mode = message.mode || "chat";
        const legacy = (0, aiAgent_1.detectAgentAction)(prompt);
        if (legacy) {
            const call = legacyActionToToolCall(legacy, message.requestId);
            await this.controller.runSingleTool(call, mode, message.requestId, prompt);
            return;
        }
        const context = (message.contexts || [])
            .slice(0, 8)
            .map((item) => `[${item.label}]\n${item.value.slice(0, 12000)}`)
            .join("\n\n");
        await this.controller.run(prompt, mode, message.requestId, message.modelId, context);
    }
    async handleTerminal(message) {
        const command = (message.command || "").trim();
        if (!command)
            throw new Error("Commande terminal vide.");
        const call = { id: `${message.requestId}-terminal`, name: "run_terminal", arguments: { command } };
        await this.controller.runSingleTool(call, message.mode || "full", message.requestId, command);
    }
    handleControllerEvent(event) {
        switch (event.type) {
            case "status":
                this.post({ type: "agentStatus", requestId: event.requestId, state: event.state, label: event.label });
                break;
            case "assistantStart":
                this.post(event);
                break;
            case "assistantDelta":
                this.post(event);
                break;
            case "assistantFinal":
                this.post(event);
                break;
            case "tool":
                if (event.event.stdout)
                    this.lastTerminalOutput = keepTail(`${this.lastTerminalOutput}\n${event.event.stdout}`);
                if (event.event.stderr)
                    this.lastTerminalOutput = keepTail(`${this.lastTerminalOutput}\n${event.event.stderr}`);
                this.post({ type: "toolEvent", requestId: event.requestId, event: event.event });
                break;
            case "usage":
                this.post(event);
                break;
            case "task":
                this.post(event);
                break;
            case "error":
                this.post({ type: "errorMessage", requestId: event.requestId, content: event.message });
                break;
            case "done":
                this.post({ type: "requestDone", requestId: event.requestId, cancelled: event.cancelled });
                break;
        }
    }
    requestPermission(request, _call, signal) {
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
    resolvePermission(id, decision) {
        const pending = this.pendingPermissions.get(id);
        if (!pending)
            return;
        this.pendingPermissions.delete(id);
        pending.resolve(decision);
    }
    rejectPendingPermissions(_reason) {
        for (const pending of this.pendingPermissions.values())
            pending.abort();
        this.pendingPermissions.clear();
    }
    async addContext(type) {
        const context = await collectContext(type, this.lastTerminalOutput);
        if (context)
            this.post({ type: "contextAdded", context });
    }
    async postRuntimeState() {
        const localProvider = (0, aiClient_1.getLiixProvider)() === "local";
        const [config, connection] = await Promise.all([
            (0, aiClient_1.getLiixRuntimeConfig)(),
            localProvider ? (0, aiClient_1.testLiixConnection)() : Promise.resolve(undefined)
        ]);
        const snapshot = await (0, aiAgent_1.inspectRuntimeSnapshot)(config.provider, config.provider === "local");
        this.post({
            type: "runtime",
            runtime: {
                ...snapshot,
                activeProvider: config.provider,
                activeMode: config.mode,
                activeEndpoint: config.endpoint,
                activeModel: config.model,
                localApiType: config.localApiType,
                localApiUrl: (0, aiClient_1.getLiixLocalApiUrl)(),
                localModel: config.localModel,
                toolCallingMode: config.toolCallingMode,
                models: config.models,
                connected: connection?.connected ?? true
            }
        });
    }
    post(message) {
        void this.view?.webview.postMessage(message);
    }
    postToast(content) {
        this.post({ type: "toast", content });
    }
}
exports.LiixAiPanelProvider = LiixAiPanelProvider;
LiixAiPanelProvider.viewType = "liixAiChat";
async function collectContext(type, terminalOutput) {
    const id = `${type}-${Date.now()}`;
    if (type === "activeFile") {
        const active = (0, aiContext_1.getActiveFileContext)();
        if (!active)
            throw new Error("Aucun fichier actif.");
        (0, aiAgent_1.resolveWorkspacePath)(active.fileName);
        return { id, type, label: path.basename(active.fileName), value: (0, aiContext_1.formatActiveFileContext)(active) };
    }
    if (type === "selection") {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty)
            throw new Error("Aucune sélection active.");
        (0, aiAgent_1.resolveWorkspacePath)(editor.document.fileName);
        return { id, type, label: `Sélection · ${path.basename(editor.document.fileName)}`, value: editor.document.getText(editor.selection).slice(0, 12000) };
    }
    if (type === "diagnostics") {
        const summary = (0, aiErrorParser_1.summarizeDiagnostics)();
        return { id, type, label: `Diagnostics · ${summary.errors} erreur(s)`, value: summary.diagnostics.join("\n") || "Aucun diagnostic." };
    }
    if (type === "terminal")
        return { id, type, label: "Dernier terminal", value: terminalOutput || "Aucune sortie terminal." };
    if (type === "gitDiff") {
        const root = (0, aiAgent_1.getWorkspaceRoot)();
        if (!root)
            throw new Error("Aucun workspace ouvert.");
        return { id, type, label: "Git diff", value: await readGitDiff(root) };
    }
    if (type === "file" || type === "folder") {
        const selection = await vscode.window.showOpenDialog({
            canSelectFiles: type === "file",
            canSelectFolders: type === "folder",
            canSelectMany: false,
            defaultUri: (0, aiAgent_1.getWorkspaceRoot)() ? vscode.Uri.file((0, aiAgent_1.getWorkspaceRoot)()) : undefined,
            openLabel: "Ajouter au contexte Liix"
        });
        const selected = selection?.[0];
        if (!selected)
            return undefined;
        const safePath = (0, aiAgent_1.resolveWorkspacePath)(selected.fsPath);
        if (type === "file") {
            const value = (await fs.promises.readFile(safePath, "utf8")).slice(0, 12000);
            return { id, type, label: path.basename(safePath), value };
        }
        const entries = (await fs.promises.readdir(safePath, { withFileTypes: true })).slice(0, 200).map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`);
        return { id, type, label: path.basename(safePath), value: entries.join("\n") };
    }
    throw new Error(`Type de contexte inconnu: ${type}`);
}
function legacyActionToToolCall(action, requestId) {
    const args = {};
    let name;
    switch (action.kind) {
        case "readFile":
            name = "read_file";
            args.path = action.filePath;
            break;
        case "writeFile":
            name = fs.existsSync((0, aiAgent_1.resolveWorkspacePath)(action.filePath || "")) ? "write_file" : "create_file";
            args.path = action.filePath;
            args.content = action.content || "";
            break;
        case "deleteFile":
            name = "delete_file";
            args.path = action.filePath;
            break;
        case "terminal":
            name = "run_terminal";
            args.command = action.command;
            break;
        case "project":
            name = "inspect_project";
            break;
        case "errors":
            name = "get_diagnostics";
            break;
        case "git": {
            const command = action.command || "git status";
            if (/^git\s+status\b/i.test(command))
                name = "git_status";
            else if (/^git\s+diff\b/i.test(command))
                name = "git_diff";
            else if (/^git\s+log\b/i.test(command))
                name = "git_log";
            else if (/^git\s+show\s+/i.test(command)) {
                name = "git_show";
                args.revision = command.replace(/^git\s+show\s+/i, "").trim();
            }
            else {
                name = "run_terminal";
                args.command = command;
            }
            break;
        }
    }
    return { id: `${requestId}-slash`, name, arguments: args };
}
function readGitDiff(cwd) {
    return new Promise((resolve) => {
        (0, child_process_1.execFile)("git", ["diff", "--"], { cwd, timeout: 10000, encoding: "utf8", maxBuffer: 512 * 1024 }, (_error, stdout, stderr) => resolve(keepTail(`${stdout || ""}\n${stderr || ""}`) || "Aucun diff."));
    });
}
function keepTail(value) {
    return value.length > 20000 ? value.slice(-20000) : value;
}
//# sourceMappingURL=aiPanel.js.map