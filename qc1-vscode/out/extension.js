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
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = this.getHtml();
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === "run") {
                this.runQC1(msg.command);
            }
            if (msg.type === "terminal") {
                this.runTerminal(msg.command);
            }
        });
    }
    getWorkspaceRoot() {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }
    runQC1(command) {
        const root = this.getWorkspaceRoot();
        if (!root) {
            this.post("Aucun workspace ouvert.");
            return;
        }
        const qc1Path = path.join(root, "scripts", "quick-command");
        const fullCommand = `"${qc1Path}" ${command}`;
        this.post(`$ qc1 ${command}\n`);
        (0, child_process_1.exec)(fullCommand, { cwd: root }, (error, stdout, stderr) => {
            if (stdout)
                this.post(stdout);
            if (stderr)
                this.post(stderr);
            if (error)
                this.post(`Erreur: ${error.message}\n`);
            this.post("\n--- terminé ---\n");
        });
    }
    runTerminal(command) {
        const root = this.getWorkspaceRoot();
        if (!root) {
            this.post("Aucun workspace ouvert.");
            return;
        }
        const qc1Path = path.join(root, "scripts", "quick-command");
        const fullCommand = `"${qc1Path}" ${command}`;
        this.post(`QC1> ${command}\n`);
        (0, child_process_1.exec)(fullCommand, { cwd: root }, (error, stdout, stderr) => {
            if (stdout)
                this.post(stdout);
            if (stderr)
                this.post(stderr);
            if (error)
                this.post(`Erreur: ${error.message}\n`);
            this.post("\nQC1 prêt.\n");
        });
    }
    post(text) {
        this.view?.webview.postMessage({
            type: "output",
            text
        });
    }
    getHtml() {
        return `
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  body {
    font-family: var(--vscode-font-family);
    padding: 10px;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
  }

  h2 {
    margin-top: 0;
    font-size: 16px;
  }

  .buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-bottom: 10px;
  }

  button {
    padding: 8px;
    border: 1px solid var(--vscode-button-border);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    border-radius: 4px;
  }

  button:hover {
    background: var(--vscode-button-hoverBackground);
  }

  #output {
    height: 300px;
    overflow-y: auto;
    white-space: pre-wrap;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    padding: 8px;
    font-family: monospace;
    font-size: 12px;
    margin-bottom: 10px;
  }

  .terminal {
    display: flex;
    gap: 5px;
  }

  input {
    flex: 1;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    padding: 7px;
  }
</style>
</head>
<body>
  <h2>QC1 STM32</h2>

  <div class="buttons">
    <button onclick="run('health')">Health</button>
    <button onclick="run('status')">Status</button>
    <button onclick="run('tsmake')">Test Make</button>
    <button onclick="run('make')">Build</button>
    <button onclick="run('flash')">Flash</button>
    <button onclick="run('error')">Errors</button>
    <button onclick="run('dev')">Dev Mode</button>
    <button onclick="clearOutput()">Clear</button>
  </div>

  <div id="output">QC1 prêt.</div>

  <div class="terminal">
    <input id="cmd" placeholder="make, health, tsmake, flash..." onkeydown="handleKey(event)" />
    <button onclick="sendTerminal()">Run</button>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  const output = document.getElementById("output");

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

  function handleKey(event) {
    if (event.key === "Enter") {
      sendTerminal();
    }
  }

  function clearOutput() {
    output.textContent = "";
  }

  window.addEventListener("message", event => {
    const msg = event.data;
    if (msg.type === "output") {
      output.textContent += "\\n" + msg.text;
      output.scrollTop = output.scrollHeight;
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
}
function deactivate() { }
//# sourceMappingURL=extension.js.map