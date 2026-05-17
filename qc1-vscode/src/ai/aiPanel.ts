import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { formatActiveFileContext, getActiveFileContext } from "./aiContext";
import { LiixAiClient } from "./aiClient";
import { liixAiModels } from "./aiModels";
import { parseBuildLog, summarizeDiagnostics } from "./aiErrorParser";

type WebviewMessage = {
  type: "sendMessage" | "readActiveFile" | "analyzeErrors";
  modelId?: string;
  message?: string;
};

export class LiixAiPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "liixAiChat";

  private view?: vscode.WebviewView;
  private readonly client = new LiixAiClient();

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      try {
        switch (message.type) {
          case "sendMessage":
            await this.handleSendMessage(message);
            break;
          case "readActiveFile":
            await this.handleReadActiveFile(message.modelId);
            break;
          case "analyzeErrors":
            await this.handleAnalyzeErrors(message.modelId);
            break;
        }
      } catch (error) {
        console.error("Liix AI webview error", error);
        this.postErrorMessage();
      }
    });
  }

  private async handleSendMessage(message: WebviewMessage) {
    const text = (message.message || "").trim();

    if (!text) {
      this.postAssistantMessage("Ecris un message avant d'envoyer.");
      return;
    }

    await waitForMockResponse();

    const response = await this.client.sendMessage({
      modelId: message.modelId || liixAiModels[0].id,
      message: text,
      mode: "chat"
    });

    this.postAssistantMessage(response.content);
  }

  private async handleReadActiveFile(modelId?: string) {
    const activeFile = getActiveFileContext();

    if (!activeFile) {
      this.postAssistantMessage("Aucun fichier actif ouvert dans VSCode.");
      return;
    }

    const context = formatActiveFileContext(activeFile);
    await waitForMockResponse();

    const response = await this.client.sendMessage({
      modelId: modelId || liixAiModels[0].id,
      message: `Lecture du fichier actif: ${activeFile.fileName}`,
      context,
      mode: "file"
    });

    this.postAssistantMessage(
      `Fichier actif lu.\n\n` +
      `Nom: ${activeFile.fileName}\n` +
      `Langage: ${activeFile.languageId}\n` +
      `Lignes: ${activeFile.lineCount}\n` +
      `${activeFile.truncated ? "Contenu tronque pour le mode dev.\n\n" : "\n"}` +
      response.content
    );
  }

  private async handleAnalyzeErrors(modelId?: string) {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    const buildLogSummary = await this.readBuildLogSummary();
    const diagnosticSummary = summarizeDiagnostics(activeUri);
    const summary = buildLogSummary
      ? {
          errors: buildLogSummary.errors + diagnosticSummary.errors,
          warnings: buildLogSummary.warnings + diagnosticSummary.warnings,
          diagnostics: [
            ...buildLogSummary.diagnostics,
            ...diagnosticSummary.diagnostics
          ].slice(0, 30),
          source: `${buildLogSummary.source} + diagnostics ${diagnosticSummary.source}`
        }
      : diagnosticSummary;
    const details = summary.diagnostics.length > 0
      ? summary.diagnostics.join("\n")
      : "Aucun diagnostic trouve pour le moment.";

    await waitForMockResponse();

    const response = await this.client.sendMessage({
      modelId: modelId || liixAiModels[0].id,
      message: `Analyser erreurs depuis ${summary.source}: ${summary.errors} erreur(s), ${summary.warnings} warning(s).`,
      context: details,
      mode: "errors"
    });

    this.postAssistantMessage(
      `Analyse erreurs (${summary.source}).\n\n` +
      `Erreurs: ${summary.errors}\n` +
      `Warnings: ${summary.warnings}\n\n` +
      `${details}\n\n` +
      response.content
    );
  }

  private async readBuildLogSummary() {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
      return undefined;
    }

    const logPath = path.join(workspaceRoot, ".qc1_last_build.log");

    if (!fs.existsSync(logPath)) {
      return undefined;
    }

    const log = await fs.promises.readFile(logPath, "utf8");
    return parseBuildLog(log);
  }

  private postAssistantMessage(content: string) {
    this.view?.webview.postMessage({
      type: "assistantMessage",
      content
    });
  }

  private postErrorMessage() {
    this.view?.webview.postMessage({
      type: "errorMessage",
      content: "Liix a rencontre un souci. Reessaie ou verifie la console de developpement."
    });
  }

  private getHtml(): string {
    const modelDisplayLabels = liixAiModels.reduce<Record<string, string>>((labels, model) => {
      labels[model.id] = `${model.label} - Training`;
      return labels;
    }, {});
    const modelDescriptions = liixAiModels.reduce<Record<string, string>>((descriptions, model) => {
      descriptions[model.id] = model.description;
      return descriptions;
    }, {});
    const modelCompactLabels: Record<string, string> = {
      "liix-code-0-1": "Liix 0.1",
      "liix-code-0-1-mini": "Mini",
      "liix-code-a1": "A1"
    };
    const modelOptions = liixAiModels.map((model) => (
      `<option value="${escapeHtml(model.id)}" title="${escapeHtml(`${model.label} - Training - ${model.description}`)}">${escapeHtml(modelCompactLabels[model.id] || `${model.label} - Training`)}</option>`
    )).join("");

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --panel: color-mix(in srgb, var(--vscode-sideBar-background) 88%, #020407);
      --panel-2: color-mix(in srgb, var(--vscode-sideBar-background) 94%, var(--vscode-editor-background));
      --border: color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
      --muted: var(--vscode-descriptionForeground);
      --fg: var(--vscode-editor-foreground);
      --blue: var(--vscode-button-background);
      --blue-hover: var(--vscode-button-hoverBackground);
      --red: #ff4f63;
      --red-soft: rgba(255, 79, 99, 0.16);
      --shadow: 0 8px 20px rgba(0, 0, 0, 0.22);
    }

    * { box-sizing: border-box; }

    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      color: var(--fg);
      background:
        radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--blue) 12%, transparent), transparent 30%),
        linear-gradient(180deg, color-mix(in srgb, var(--bg) 92%, #03060a) 0%, var(--bg) 100%);
    }

    .ai-root {
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    .ai-header {
      flex: 0 0 auto;
      min-width: 0;
      padding: 10px 10px 8px;
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--panel) 94%, #020407);
    }

    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }

    .title-wrap {
      min-width: 0;
    }

    .title {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      font-size: 15px;
      font-weight: 900;
      letter-spacing: 0;
    }

    .liix-dot {
      width: 8px;
      height: 8px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: var(--red);
      box-shadow: 0 0 10px rgba(255, 79, 99, 0.65);
    }

    .status-line {
      margin-top: 2px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ai-badge {
      flex: 0 0 auto;
      padding: 2px 7px;
      border: 1px solid color-mix(in srgb, var(--red) 42%, var(--border));
      border-radius: 999px;
      background: var(--red-soft);
      color: #ff9aa5;
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .model-strip {
      display: none;
    }

    select, textarea {
      width: 100%;
      min-width: 0;
      border: 1px solid var(--vscode-input-border, var(--border));
      border-radius: 7px;
      color: var(--vscode-input-foreground);
      background: color-mix(in srgb, var(--vscode-input-background) 88%, #020407);
      font-family: var(--vscode-font-family);
    }

    select {
      height: 30px;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 700;
    }

    .model-meta {
      min-width: 0;
      padding: 6px 8px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: color-mix(in srgb, var(--panel-2) 90%, #020407);
      font-size: 11px;
      line-height: 1.35;
    }

    .model-meta-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }

    .model-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 800;
    }

    .model-status {
      flex: 0 0 auto;
      padding: 1px 6px;
      border-radius: 999px;
      background: var(--red-soft);
      color: #ff9aa5;
      font-size: 10px;
      font-weight: 900;
    }

    .model-desc {
      margin-top: 3px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }

    .quick-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    button {
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 7px;
      padding: 6px 9px;
      color: var(--vscode-button-foreground);
      background: var(--blue);
      cursor: pointer;
      font-size: 12px;
      font-weight: 800;
      transition: transform 0.16s ease, background 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease;
    }

    button:hover:not(:disabled) {
      background: linear-gradient(135deg, var(--blue-hover), color-mix(in srgb, var(--blue-hover) 86%, var(--red)));
      box-shadow: 0 5px 14px rgba(0, 0, 0, 0.22);
      transform: translateY(-1px);
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.62;
      transform: none;
      box-shadow: none;
    }

    .secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }

    .ai-messages {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 8px 9px;
      background: color-mix(in srgb, var(--bg) 92%, #020407);
      white-space: pre-wrap;
    }

    .message {
      max-width: 96%;
      margin-bottom: 7px;
      padding: 8px 9px;
      border: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
      border-radius: 11px;
      background: var(--panel-2);
      line-height: 1.4;
      font-size: 12px;
      overflow-wrap: anywhere;
      animation: fadeIn 0.2s ease both;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.14);
    }

    .message.user {
      margin-left: auto;
      border-color: color-mix(in srgb, var(--blue) 34%, var(--border));
      background: color-mix(in srgb, var(--blue) 16%, var(--panel-2));
    }

    .message.assistant {
      margin-right: auto;
      border-color: color-mix(in srgb, var(--red) 18%, var(--border));
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--panel-2) 94%, var(--blue)), color-mix(in srgb, var(--panel-2) 96%, var(--red)));
      box-shadow:
        0 5px 14px rgba(0, 0, 0, 0.14),
        0 0 0 1px color-mix(in srgb, var(--blue) 7%, transparent),
        0 0 18px rgba(255, 79, 99, 0.045);
    }

    .message.system {
      max-width: 100%;
      margin: 0 0 7px;
      padding: 7px 9px;
      border-color: color-mix(in srgb, var(--blue) 18%, var(--border));
      background: color-mix(in srgb, var(--panel-2) 88%, #020407);
      color: color-mix(in srgb, var(--fg) 78%, var(--muted));
      box-shadow: none;
    }

    .message.loading {
      display: flex;
      align-items: center;
      gap: 8px;
      border-color: color-mix(in srgb, var(--red) 26%, var(--border));
      background: color-mix(in srgb, var(--panel-2) 90%, #020407);
      transition: opacity 0.16s ease, transform 0.16s ease;
    }

    .message.error {
      margin-right: auto;
      border-color: rgba(255, 79, 99, 0.62);
      background: rgba(255, 79, 99, 0.10);
      color: #ffb5bd;
    }

    .role {
      display: block;
      margin-bottom: 3px;
      color: var(--muted);
      font-size: 9px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .message.system .role {
      display: inline;
      margin: 0 6px 0 0;
      color: color-mix(in srgb, var(--blue) 72%, var(--muted));
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

    .loading-subtitle {
      color: var(--muted);
      font-size: 11px;
      transition: opacity 0.12s ease;
    }

    .thinking-dots .content::after {
      content: ".";
      animation: dots 1.2s steps(3, end) infinite;
    }

    .ai-composer {
      flex: 0 0 auto;
      position: sticky;
      bottom: 0;
      padding: 8px 10px 10px;
      border-top: 1px solid var(--border);
      background: color-mix(in srgb, var(--panel) 94%, #020407);
    }

    .composer-box {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
      min-width: 0;
    }

    .control-bar {
      display: grid;
      grid-template-columns: minmax(42px, 0.82fr) minmax(48px, 1fr) minmax(38px, 0.72fr) 38px 42px 32px;
      align-items: center;
      gap: 4px;
      min-width: 0;
      margin-top: 6px;
      overflow: visible;
    }

    .control-item {
      min-width: 0;
      width: 100%;
      height: 26px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: color-mix(in srgb, var(--panel-2) 90%, #020407);
      color: var(--fg);
      font-size: 10px;
      font-weight: 800;
    }

    .control-select {
      max-width: none;
      padding: 2px 4px;
      text-overflow: ellipsis;
    }

    .context-select {
      max-width: none;
    }

    .permissions-menu {
      position: relative;
      max-width: none;
      overflow: visible;
    }

    .permissions-menu summary {
      height: 24px;
      padding: 5px 6px;
      cursor: pointer;
      list-style: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .permissions-menu summary::-webkit-details-marker {
      display: none;
    }

    .permissions-menu[open] summary {
      color: var(--vscode-button-foreground);
      background: color-mix(in srgb, var(--blue) 28%, transparent);
      border-radius: 6px;
    }

    .permissions-popover {
      position: absolute;
      right: 0;
      bottom: 32px;
      z-index: 10;
      width: min(240px, 78vw);
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel) 96%, #020407);
      box-shadow: var(--shadow);
    }

    .permission-row {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 5px 3px;
      color: var(--fg);
      font-size: 11px;
      font-weight: 700;
    }

    .permission-row input {
      accent-color: var(--blue);
    }

    .usage-chip {
      width: 100%;
      padding: 4px 5px;
    }

    .usage-top {
      display: flex;
      justify-content: center;
      gap: 4px;
      line-height: 1;
    }

    .usage-count {
      display: none;
      color: var(--muted);
      font-weight: 700;
    }

    .usage-bar {
      height: 3px;
      margin-top: 4px;
      border-radius: 999px;
      background: rgba(127, 127, 127, 0.22);
      overflow: hidden;
    }

    .usage-fill {
      width: 0%;
      height: 100%;
      border-radius: 999px;
      background: var(--blue);
      transition: width 0.2s ease, background 0.2s ease;
    }

    .usage-chip.warn .usage-fill {
      background: var(--red);
    }

    .usage-chip.limit {
      border-color: rgba(255, 79, 99, 0.72);
      color: #ffb5bd;
    }

    .usage-chip.limit .usage-fill {
      background: #ff243e;
    }

    .server-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      max-width: none;
      padding: 0 5px;
      white-space: nowrap;
      color: #9dd8ff;
    }

    .server-badge::before {
      content: "";
      width: 6px;
      height: 6px;
      margin-right: 4px;
      border-radius: 999px;
      background: var(--blue);
      box-shadow: 0 0 8px color-mix(in srgb, var(--blue) 62%, transparent);
    }

    .server-badge.offline,
    .server-badge.training {
      color: #ff9aa5;
      border-color: color-mix(in srgb, var(--red) 45%, var(--border));
    }

    .server-badge.offline::before,
    .server-badge.training::before {
      background: var(--red);
      box-shadow: 0 0 8px rgba(255, 79, 99, 0.6);
    }

    textarea {
      min-height: 34px;
      max-height: 74px;
      padding: 7px 8px;
      resize: vertical;
      line-height: 1.35;
      font-size: 12px;
    }

    .send-button {
      width: 32px;
      height: 26px;
      min-width: 32px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
    }

    .send-arrow {
      font-size: 14px;
      line-height: 1;
    }

    .button-spinner {
      display: none;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.36);
      border-top-color: var(--vscode-button-foreground);
      animation: spin 0.8s linear infinite;
    }

    .send-button.loading .button-spinner {
      display: inline-block;
    }

    .send-button.loading .send-arrow {
      display: none;
    }

    .composer-hint {
      margin-top: 3px;
      color: var(--muted);
      font-size: 9px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
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

    @media (max-width: 420px) {
      .ai-header { padding: 8px; }
      .ai-messages { padding: 6px; }
      .ai-composer { padding: 6px 7px 7px; }
      .quick-actions button { flex: 1 1 auto; }
      .message { max-width: 100%; margin-bottom: 6px; padding: 7px 8px; }
      .control-bar {
        grid-template-columns: minmax(38px, 0.82fr) minmax(42px, 0.92fr) 34px 34px 36px 30px;
        gap: 3px;
      }
      .control-item { height: 24px; font-size: 9px; border-radius: 6px; }
      .control-select { padding: 1px 2px; }
      .permissions-menu summary { height: 22px; padding: 4px 5px; }
      .server-badge { padding: 0 4px; }
      .server-badge::before { margin-right: 3px; }
      .send-button { width: 30px; height: 24px; min-width: 30px; }
      textarea { min-height: 32px; max-height: 62px; padding: 6px 7px; }
    }

    @media (max-width: 320px) {
      .control-bar {
        grid-template-columns: minmax(34px, 0.8fr) minmax(38px, 0.9fr) 30px 32px 30px 28px;
      }
      .control-item { font-size: 8.5px; }
      .server-badge span { display: none; }
      .server-badge::before { margin-right: 0; }
    }
  </style>
</head>
<body>
  <div class="ai-root">
    <header class="ai-header">
      <div class="header-row">
        <div class="title-wrap">
          <div class="title"><span class="liix-dot"></span><span>Liix AI</span></div>
          <div class="status-line">Mock/dev &middot; mod&egrave;les en entra&icirc;nement</div>
        </div>
        <span class="ai-badge">AI</span>
      </div>
      <div class="quick-actions">
        <button class="secondary" onclick="readActiveFile()">Lire le fichier actif</button>
        <button class="secondary" onclick="analyzeErrors()">Analyser erreurs</button>
      </div>
    </header>

    <main id="chat" class="ai-messages">
      <div class="message system">
        <span class="role">Systeme</span>
        <span class="content">Mock/dev actif. Les reponses Liix sont simulees pendant l'entrainement des modeles.</span>
      </div>
    </main>

    <footer class="ai-composer">
      <div class="composer-box">
        <textarea id="messageInput" placeholder="Message"></textarea>
      </div>
      <div class="control-bar">
        <select id="contextSelect" class="control-item control-select context-select" aria-label="Mode contexte" title="Mode contexte">
          <option value="question" title="Question - repond sans analyser le code">ctx</option>
          <option value="active-file" title="Fichier actif - utilise seulement le fichier ouvert">file</option>
          <option value="project" title="Projet - peut lire le workspace">proj</option>
          <option value="errors" title="Erreurs - analyse les erreurs build/terminal">err</option>
          <option value="agent" title="Agent - peut proposer des changements">agent</option>
          <option value="autocomplete" title="Autocomplete - prevu pour suggestions inline plus tard">Auto</option>
        </select>
        <select id="modelSelect" class="control-item control-select" aria-label="Modele AI">${modelOptions}</select>
        <details id="permissionsMenu" class="control-item permissions-menu">
          <summary id="permissionsSummary">RO</summary>
          <div class="permissions-popover">
            <label class="permission-row"><input type="checkbox" value="read-only" checked /> Lecture seule</label>
            <label class="permission-row"><input type="checkbox" value="ask-before-edit" /> Demander avant modification</label>
            <label class="permission-row"><input type="checkbox" value="auto-apply" /> Auto apply</label>
            <label class="permission-row"><input type="checkbox" value="terminal-forbidden" checked /> Terminal interdit</label>
            <label class="permission-row"><input type="checkbox" value="terminal-approval" /> Terminal avec approbation</label>
            <label class="permission-row"><input type="checkbox" value="build-allowed" /> Build autorise</label>
          </div>
        </details>
        <div id="usageChip" class="control-item usage-chip" title="Usage tokens mock/dev">
          <div class="usage-top"><span id="usagePercent">6%</span><span id="usageCount" class="usage-count">1 240 / 20 000</span></div>
          <div class="usage-bar"><div id="usageFill" class="usage-fill"></div></div>
        </div>
        <div id="serverBadge" class="control-item server-badge"><span>On</span></div>
        <button id="sendButton" class="send-button" onclick="sendMessage()" title="Envoyer">
          <span class="button-spinner"></span>
          <span id="sendLabel" class="send-arrow">↑</span>
        </button>
      </div>
      <div class="composer-hint">Entree: nouvelle ligne &middot; Cmd/Ctrl+Entree: envoyer</div>
    </footer>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const chat = document.getElementById("chat");
    const input = document.getElementById("messageInput");
    const modelSelect = document.getElementById("modelSelect");
    const contextSelect = document.getElementById("contextSelect");
    const permissionsMenu = document.getElementById("permissionsMenu");
    const permissionsSummary = document.getElementById("permissionsSummary");
    const permissionInputs = Array.from(document.querySelectorAll('.permissions-popover input'));
    const usageChip = document.getElementById("usageChip");
    const usagePercent = document.getElementById("usagePercent");
    const usageCount = document.getElementById("usageCount");
    const usageFill = document.getElementById("usageFill");
    const serverBadge = document.getElementById("serverBadge");
    const sendButton = document.getElementById("sendButton");
    const sendLabel = document.getElementById("sendLabel");
    const waitingStates = [
      "Liix reflechit...",
      "Liix analyse...",
      "Liix ecrit...",
    ];
    const aiControlState = {
      contextMode: "question",
      permissions: ["read-only", "terminal-forbidden"],
      usage: {
        usedInputTokens: 620,
        usedOutputTokens: 620,
        usedTotalTokens: 1240,
        dailyLimit: 20000,
        monthlyLimit: 500000,
        dailyPercent: 6,
        estimatedMessagesLeft: 37,
        averageTokensPerMessage: 500
      },
      server: {
        serverStatus: "online",
        latencyMs: 42,
        queuePosition: 0
      }
    };
    let isGenerating = false;
    let waitingTimer = undefined;
    let waitingIndex = 0;
    let loadingBubble = undefined;

    function estimateTokens(text) {
      return Math.ceil(String(text || "").length / 4);
    }

    function formatNumber(value) {
      return new Intl.NumberFormat("fr-CA").format(value);
    }

    function recalcUsage() {
      const usage = aiControlState.usage;
      usage.usedTotalTokens = usage.usedInputTokens + usage.usedOutputTokens;
      usage.dailyPercent = Math.min(100, Math.round((usage.usedTotalTokens / usage.dailyLimit) * 100));
      usage.estimatedMessagesLeft = Math.max(0, Math.floor((usage.dailyLimit - usage.usedTotalTokens) / usage.averageTokensPerMessage));
    }

    function updateUsageUi() {
      recalcUsage();
      const usage = aiControlState.usage;
      usagePercent.textContent = usage.dailyPercent + "%";
      usageCount.textContent = formatNumber(usage.usedTotalTokens) + " / " + formatNumber(usage.dailyLimit);
      usageFill.style.width = usage.dailyPercent + "%";
      usageChip.classList.toggle("warn", usage.dailyPercent >= 85 && usage.dailyPercent < 100);
      usageChip.classList.toggle("limit", usage.dailyPercent >= 100);
      usageChip.title =
        "Input: " + formatNumber(usage.usedInputTokens) +
        " | Output: " + formatNumber(usage.usedOutputTokens) +
        " | Restants estimes: " + formatNumber(usage.estimatedMessagesLeft) +
        " | Mensuel: " + formatNumber(usage.monthlyLimit);
    }

    function getServerLabel() {
      const server = aiControlState.server;

      if (server.serverStatus === "queue") {
        return "Q" + server.queuePosition;
      }

      const shortLabels = {
        online: "On",
        busy: "Busy",
        offline: "Off",
        training: "Train"
      };

      return shortLabels[server.serverStatus] || server.serverStatus.charAt(0).toUpperCase() + server.serverStatus.slice(1);
    }

    function updateServerUi() {
      const server = aiControlState.server;
      serverBadge.innerHTML = "<span>" + getServerLabel() + "</span>";
      serverBadge.className = "control-item server-badge " + server.serverStatus;
      serverBadge.title =
        "Serveur mock/dev | Status: " + server.serverStatus +
        " | Latence: " + server.latencyMs + " ms" +
        " | Queue: " + server.queuePosition;
    }

    function updatePermissionsState() {
      aiControlState.permissions = permissionInputs
        .filter((input) => input.checked)
        .map((input) => input.value);

      const labels = [];
      const shortLabels = [];
      if (aiControlState.permissions.includes("read-only")) { labels.push("Lecture seule"); shortLabels.push("RO"); }
      if (aiControlState.permissions.includes("ask-before-edit")) { labels.push("Demander avant modification"); shortLabels.push("Ask"); }
      if (aiControlState.permissions.includes("auto-apply")) { labels.push("Auto apply"); shortLabels.push("Auto"); }
      if (aiControlState.permissions.includes("terminal-forbidden")) { labels.push("Terminal interdit"); shortLabels.push("NoT"); }
      if (aiControlState.permissions.includes("terminal-approval")) { labels.push("Terminal avec approbation"); shortLabels.push("TA"); }
      if (aiControlState.permissions.includes("build-allowed")) { labels.push("Build autorise"); shortLabels.push("Build"); }
      permissionsSummary.textContent = shortLabels[0] || "Perm";
      permissionsSummary.title = labels.join(" | ");
    }

    function appendMessage(role, text, options = {}) {
      const message = document.createElement("div");
      message.className = "message " + role;

      const label = document.createElement("span");
      label.className = "role";
      label.textContent = role === "user" ? "Vous" : role === "error" ? "Erreur Liix" : "Liix AI";

      const content = document.createElement("span");
      content.className = "content";

      message.appendChild(label);
      message.appendChild(content);
      chat.appendChild(message);
      chat.scrollTop = chat.scrollHeight;

      if (options.typewriter) {
        typeText(content, text);
      } else {
        content.textContent = text;
      }

      return message;
    }

    function typeText(target, text) {
      target.classList.add("typing-caret");
      const chunks = text.match(/\\S+\\s*|\\n+/g) || [text];
      let index = 0;

      function writeNextChunk() {
        if (index >= chunks.length) {
          target.classList.remove("typing-caret");
          return;
        }

        target.textContent += chunks[index];
        index += 1;
        chat.scrollTop = chat.scrollHeight;

        const delay = chunks[index - 1].includes("\\n") ? 42 : 22 + Math.floor(Math.random() * 28);
        window.setTimeout(writeNextChunk, delay);
      }

      writeNextChunk();
    }

    function setGenerating(active) {
      isGenerating = active;
      input.disabled = active;
      modelSelect.disabled = active;
      contextSelect.disabled = active;
      permissionInputs.forEach((input) => input.disabled = active);
      sendButton.classList.toggle("loading", active);
      sendLabel.textContent = active ? "" : "\\u2191";
      updateSendAvailability();
    }

    function startLoadingBubble() {
      waitingIndex = 0;
      loadingBubble = document.createElement("div");
      loadingBubble.className = "message assistant loading";
      loadingBubble.dataset.loadingBubble = "true";
      loadingBubble.innerHTML =
        '<div class="ai-ring"></div>' +
        '<div class="loading-text">' +
        '<div class="loading-title"><span class="content">Liix travaille</span></div>' +
        '<div id="loadingSubtitle" class="loading-subtitle">' + waitingStates[waitingIndex] + '</div>' +
        '</div>';
      chat.appendChild(loadingBubble);
      chat.scrollTop = chat.scrollHeight;

      waitingTimer = window.setInterval(() => {
        waitingIndex = (waitingIndex + 1) % waitingStates.length;
        const loadingSubtitle = document.getElementById("loadingSubtitle");
        if (loadingSubtitle) {
          loadingSubtitle.style.opacity = "0";
          window.setTimeout(() => {
            loadingSubtitle.textContent = waitingStates[waitingIndex];
            loadingSubtitle.style.opacity = "1";
            chat.scrollTop = chat.scrollHeight;
          }, 120);
        }
      }, 850);
    }

    function stopLoadingBubble() {
      if (waitingTimer) {
        window.clearInterval(waitingTimer);
        waitingTimer = undefined;
      }

      if (loadingBubble) {
        loadingBubble.remove();
        loadingBubble = undefined;
      }
    }

    function beginRequest() {
      setGenerating(true);
      startLoadingBubble();
    }

    function finishRequest() {
      stopLoadingBubble();
      setGenerating(false);
    }

    function sendMessage() {
      const text = input.value.trim();

      if (!text || isGenerating) {
        updateSendAvailability();
        return;
      }

      appendMessage("user", text);
      input.value = "";
      aiControlState.usage.usedInputTokens += estimateTokens(text);
      updateUsageUi();
      beginRequest();
      vscode.postMessage({
        type: "sendMessage",
        modelId: modelSelect.value,
        message: text,
        contextMode: aiControlState.contextMode,
        permissions: aiControlState.permissions
      });
    }

    function readActiveFile() {
      if (isGenerating) return;

      beginRequest();
      aiControlState.usage.usedInputTokens += estimateTokens("Lire le fichier actif");
      updateUsageUi();
      vscode.postMessage({
        type: "readActiveFile",
        modelId: modelSelect.value,
        contextMode: aiControlState.contextMode,
        permissions: aiControlState.permissions
      });
    }

    function analyzeErrors() {
      if (isGenerating) return;

      beginRequest();
      aiControlState.usage.usedInputTokens += estimateTokens("Analyser erreurs");
      updateUsageUi();
      vscode.postMessage({
        type: "analyzeErrors",
        modelId: modelSelect.value,
        contextMode: aiControlState.contextMode,
        permissions: aiControlState.permissions
      });
    }

    function updateContextMode() {
      aiControlState.contextMode = contextSelect.value;
    }

    function updateSendAvailability() {
      const serverStatus = aiControlState.server.serverStatus;
      const quotaReached = aiControlState.usage.usedTotalTokens >= aiControlState.usage.dailyLimit;
      const serverBlocksSend = serverStatus === "offline";
      sendButton.disabled = isGenerating || input.value.trim().length === 0 || quotaReached || serverBlocksSend;
    }

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        sendMessage();
      }
    });

    input.addEventListener("input", updateSendAvailability);
    modelSelect.addEventListener("change", updateSendAvailability);
    contextSelect.addEventListener("change", updateContextMode);
    permissionInputs.forEach((permissionInput) => {
      permissionInput.addEventListener("change", updatePermissionsState);
    });
    updateContextMode();
    updatePermissionsState();
    updateUsageUi();
    updateServerUi();
    updateSendAvailability();

    window.addEventListener("message", (event) => {
      const message = event.data;

      if (message.type === "assistantMessage") {
        finishRequest();
        aiControlState.usage.usedOutputTokens += estimateTokens(message.content);
        updateUsageUi();
        appendMessage("assistant", message.content, { typewriter: true });
      }

      if (message.type === "errorMessage") {
        finishRequest();
        appendMessage("error", message.content || "Liix a rencontre un souci. Reessaie ou verifie la console de developpement.");
      }
    });

    window.addEventListener("error", () => {
      finishRequest();
      appendMessage("error", "Liix a rencontre un souci. Reessaie ou verifie la console de developpement.");
    });
  </script>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function waitForMockResponse(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 800));
}
