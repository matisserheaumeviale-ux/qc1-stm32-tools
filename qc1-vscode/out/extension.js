"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const child_process_1 = require("child_process");
const path = require("path");
class QC1PanelProvider {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this.outputLines = [];
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = this.getHtml();
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case "run":
                    this.runQC1(msg.command);
                    break;
                case "terminal":
                    this.runQC1(msg.command);
                    break;
                case "clear":
                    this.clearOutput();
                    break;
                case "settings":
                    vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Mistral400.QC1-STM32-Tools");
                    break;
                case "refreshSettings":
                    this.sendSettings();
                    break;
            }
        });
        this.sendSettings();
        this.postStatus("Ready", "idle");
    }
    getWorkspaceRoot() {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }
    getConfig() {
        const config = vscode.workspace.getConfiguration("qc1");
        return {
            quickCommandPath: config.get("quickCommandPath", "./scripts/quick-command"),
            autoClearOutput: config.get("autoClearOutput", false),
            showTimestamps: config.get("showTimestamps", true),
            outputMaxLines: config.get("outputMaxLines", 500),
            compactMode: config.get("compactMode", false)
        };
    }
    runQC1(command) {
        const root = this.getWorkspaceRoot();
        const config = this.getConfig();
        if (!root) {
            this.appendOutput("Aucun workspace ouvert.", "error");
            this.postStatus("No workspace", "error");
            return;
        }
        if (config.autoClearOutput) {
            this.clearOutput();
        }
        const qc1Path = path.isAbsolute(config.quickCommandPath)
            ? config.quickCommandPath
            : path.join(root, config.quickCommandPath);
        const fullCommand = `"${qc1Path}" ${command}`;
        this.postStatus(`Running: ${command}`, "running");
        this.appendOutput(`$ qc1 ${command}`, "command");
        (0, child_process_1.exec)(fullCommand, { cwd: root }, (error, stdout, stderr) => {
            if (stdout)
                this.appendOutput(stdout, "stdout");
            if (stderr)
                this.appendOutput(stderr, "stderr");
            if (error) {
                this.appendOutput(`Erreur: ${error.message}`, "error");
                this.postStatus(`Failed: ${command}`, "error");
            }
            else {
                this.postStatus(`Done: ${command}`, "success");
            }
            this.appendOutput("--- terminé ---", "separator");
        });
    }
    appendOutput(text, kind = "stdout") {
        const config = this.getConfig();
        const timestamp = config.showTimestamps
            ? `[${new Date().toLocaleTimeString()}] `
            : "";
        const lines = text
            .toString()
            .split(/\r?\n/)
            .filter((line) => line.length > 0)
            .map((line) => `${timestamp}${line}`);
        this.outputLines.push(...lines);
        if (this.outputLines.length > config.outputMaxLines) {
            this.outputLines = this.outputLines.slice(-config.outputMaxLines);
        }
        this.view?.webview.postMessage({
            type: "output",
            kind,
            lines
        });
    }
    clearOutput() {
        this.outputLines = [];
        this.view?.webview.postMessage({ type: "clearOutput" });
        this.postStatus("Output cleared", "idle");
    }
    postStatus(text, state) {
        this.view?.webview.postMessage({
            type: "status",
            text,
            state
        });
    }
    sendSettings() {
        this.view?.webview.postMessage({
            type: "settings",
            settings: this.getConfig()
        });
    }
    getHtml() {
        return `
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  :root {
    --radius: 8px;
    --gap: 8px;
  }

  body {
    margin: 0;
    padding: 10px;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .title {
    font-weight: 700;
    font-size: 15px;
  }

  .badge {
    padding: 3px 7px;
    border-radius: 999px;
    font-size: 11px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }

  .badge.idle { background: #555; }
  .badge.running { background: #b58900; }
  .badge.success { background: #16825d; }
  .badge.error { background: #b00020; }

  .tabs {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 4px;
    margin-bottom: 10px;
  }

  .tab {
    padding: 7px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    cursor: pointer;
    border-radius: var(--radius);
  }

  .tab.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .panel {
    display: none;
  }

  .panel.active {
    display: block;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gap);
  }

  button {
    padding: 8px;
    border: 1px solid var(--vscode-button-border);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    border-radius: var(--radius);
  }

  button:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }

  .card {
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
    border-radius: var(--radius);
    padding: 10px;
    margin-bottom: 10px;
  }

  .card-title {
    font-weight: 700;
    margin-bottom: 7px;
  }

  #output {
    height: 360px;
    overflow-y: auto;
    white-space: pre-wrap;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--radius);
    padding: 8px;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    line-height: 1.45;
  }

  .line.command { color: #4fc3f7; }
  .line.stderr { color: #ffb74d; }
  .line.error { color: #ff6b6b; }
  .line.separator { color: #888; }
  .line.stdout { color: var(--vscode-foreground); }

  .terminal {
    display: flex;
    gap: 5px;
    margin-top: 8px;
  }

  input {
    flex: 1;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: var(--radius);
    padding: 7px;
  }

  .setting-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .setting-name {
    font-weight: 600;
  }

  .setting-value {
    opacity: 0.8;
    text-align: right;
    word-break: break-all;
  }

  .hint {
    opacity: 0.75;
    font-size: 12px;
    line-height: 1.4;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="title">QC1 STM32</div>
    <div id="status" class="badge idle">Ready</div>
  </div>

  <div class="tabs">
    <button class="tab active" onclick="showTab('dashboard')">Dashboard</button>
    <button class="tab" onclick="showTab('outputPanel')">Output</button>
    <button class="tab" onclick="showTab('settingsPanel')">Settings</button>
  </div>

  <section id="dashboard" class="panel active">
    <div class="card">
      <div class="card-title">Actions rapides</div>
      <div class="grid">
        <button onclick="run('health')">Health</button>
        <button onclick="run('status')">Status</button>
        <button onclick="run('tsmake')">Test Make</button>
        <button onclick="run('make')">Build</button>
        <button onclick="run('flash')">Flash</button>
        <button onclick="run('error')">Errors</button>
        <button onclick="run('dev')">Dev Mode</button>
        <button class="secondary" onclick="clearOutput()">Clear</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Mini terminal QC1</div>
      <div class="hint">Tape une commande QC1 : make, health, status, tsmake, flash, error...</div>
      <div class="terminal">
        <input id="cmd" placeholder="make" onkeydown="handleKey(event)" />
        <button onclick="sendTerminal()">Run</button>
      </div>
    </div>
  </section>

  <section id="outputPanel" class="panel">
    <div class="card">
      <div class="card-title">Sortie QC1</div>
      <div id="output">QC1 prêt.</div>
      <div class="terminal">
        <input id="cmd2" placeholder="health" onkeydown="handleKey2(event)" />
        <button onclick="sendTerminal2()">Run</button>
      </div>
    </div>
  </section>

  <section id="settingsPanel" class="panel">
    <div class="card">
      <div class="card-title">Paramètres QC1</div>

      <div class="setting-row">
        <div class="setting-name">Quick Command Path</div>
        <div id="sPath" class="setting-value"></div>
      </div>

      <div class="setting-row">
        <div class="setting-name">Auto-clear Output</div>
        <div id="sAutoClear" class="setting-value"></div>
      </div>

      <div class="setting-row">
        <div class="setting-name">Show Timestamps</div>
        <div id="sTimestamps" class="setting-value"></div>
      </div>

      <div class="setting-row">
        <div class="setting-name">Max Output Lines</div>
        <div id="sMaxLines" class="setting-value"></div>
      </div>

      <div class="setting-row">
        <div class="setting-name">Compact Mode</div>
        <div id="sCompact" class="setting-value"></div>
      </div>

      <br>
      <button onclick="openSettings()">Open VSCode Settings</button>
      <button class="secondary" onclick="refreshSettings()">Refresh</button>
    </div>

    <div class="card">
      <div class="card-title">Notes</div>
      <div class="hint">
        Ces paramètres sont stockés dans VSCode. Tu peux les modifier dans Settings, puis cliquer Refresh ici.
      </div>
    </div>
  </section>

<script>
  const vscode = acquireVsCodeApi();

  function showTab(id) {
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    event.target.classList.add("active");
  }

  function run(command) {
    vscode.postMessage({ type: "run", command });
  }

  function sendTerminal() {
    const input = document.getElementById("cmd");
    const command = input.value.trim();
    if (!command) return;
    vscode.postMessage({ type: "terminal", command });
    input.value = "";
  }

  function sendTerminal2() {
    const input = document.getElementById("cmd2");
    const command = input.value.trim();
    if (!command) return;
    vscode.postMessage({ type: "terminal", command });
    input.value = "";
  }

  function handleKey(event) {
    if (event.key === "Enter") sendTerminal();
  }

  function handleKey2(event) {
    if (event.key === "Enter") sendTerminal2();
  }

  function clearOutput() {
    vscode.postMessage({ type: "clear" });
  }

  function openSettings() {
    vscode.postMessage({ type: "settings" });
  }

  function refreshSettings() {
    vscode.postMessage({ type: "refreshSettings" });
  }

  function appendLines(lines, kind) {
    const output = document.getElementById("output");
    if (output.textContent === "QC1 prêt.") output.textContent = "";

    for (const line of lines) {
      const div = document.createElement("div");
      div.className = "line " + kind;
      div.textContent = line;
      output.appendChild(div);
    }

    output.scrollTop = output.scrollHeight;
  }

  function setStatus(text, state) {
    const el = document.getElementById("status");
    el.textContent = text;
    el.className = "badge " + state;
  }

  function setSettings(settings) {
    document.getElementById("sPath").textContent = settings.quickCommandPath;
    document.getElementById("sAutoClear").textContent = settings.autoClearOutput;
    document.getElementById("sTimestamps").textContent = settings.showTimestamps;
    document.getElementById("sMaxLines").textContent = settings.outputMaxLines;
    document.getElementById("sCompact").textContent = settings.compactMode;
  }

  window.addEventListener("message", event => {
    const msg = event.data;

    if (msg.type === "output") {
      appendLines(msg.lines, msg.kind);
    }

    if (msg.type === "clearOutput") {
      document.getElementById("output").textContent = "";
    }

    if (msg.type === "status") {
      setStatus(msg.text, msg.state);
    }

    if (msg.type === "settings") {
      setSettings(msg.settings);
    }
  });
</script>
</body>
</html>
`;
    }
}
QC1PanelProvider.viewType = "qc1.panel";
function activate(context) {
    const provider = new QC1PanelProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(QC1PanelProvider.viewType, provider));
    const runInTerminal = (cmd) => {
        const terminal = vscode.window.createTerminal("QC1");
        terminal.show();
        terminal.sendText(`./scripts/quick-command ${cmd}`);
    };
    context.subscriptions.push(vscode.commands.registerCommand("qc1.build", () => runInTerminal("make")));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.tsmake", () => runInTerminal("tsmake")));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.flash", () => runInTerminal("flash")));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.health", () => runInTerminal("health")));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.status", () => runInTerminal("status")));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.error", () => runInTerminal("error")));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.dev", () => runInTerminal("dev")));
    context.subscriptions.push(vscode.commands.registerCommand("qc1.openSettings", () => {
        vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Mistral400.QC1-STM32-Tools");
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map