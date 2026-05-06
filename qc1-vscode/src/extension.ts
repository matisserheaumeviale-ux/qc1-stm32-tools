import * as vscode from "vscode";
import { exec } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getQuickCommandPath(context: vscode.ExtensionContext): string {
  const config = vscode.workspace.getConfiguration("qc1");
  const customPath = config.get<string>("quickCommandPath", "").trim();

  if (customPath && fileExists(customPath)) {
    return customPath;
  }

  const root = getWorkspaceRoot();

  if (root) {
    const workspaceScript =
      os.platform() === "win32"
        ? path.join(root, "scripts", "quick-command.ps1")
        : path.join(root, "scripts", "quick-command");

    if (fileExists(workspaceScript)) {
      return workspaceScript;
    }
  }

  const bundledScript =
    os.platform() === "win32"
      ? path.join(context.extensionPath, "resources", "scripts", "quick-command.ps1")
      : path.join(context.extensionPath, "resources", "scripts", "quick-command");

  if (fileExists(bundledScript)) {
    return bundledScript;
  }

  return "quick-command";
}

function runQuickCommand(context: vscode.ExtensionContext, args: string[]) {
  const terminal = vscode.window.createTerminal("QC1 STM32");
  const quickCommand = getQuickCommandPath(context);
  const quotedArgs = args.map((arg) => `"${arg.replace(/"/g, '\\"')}"`).join(" ");

  if (os.platform() === "win32") {
    terminal.sendText(`powershell -ExecutionPolicy Bypass -File "${quickCommand}" ${quotedArgs}`.trim());
  } else {
    terminal.sendText(`chmod +x "${quickCommand}"`);
    terminal.sendText(`"${quickCommand}" ${quotedArgs}`.trim());
  }

  terminal.show();
}

class QC1PanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "qc1.panel";
  private view?: vscode.WebviewView;
  private outputLines: string[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
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
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "@ext:Mistral400.QC1-STM32-Tools"
          );
          break;

        case "refreshSettings":
          this.sendSettings();
          break;
      }
    });

    this.sendSettings();
    this.postStatus("Ready", "idle");
  }

  private getConfig() {
    const config = vscode.workspace.getConfiguration("qc1");

    return {
      quickCommandPath: getQuickCommandPath(this.context),
      autoClearOutput: config.get<boolean>("autoClearOutput", false),
      showTimestamps: config.get<boolean>("showTimestamps", true),
      outputMaxLines: config.get<number>("outputMaxLines", 500),
      compactMode: config.get<boolean>("compactMode", false)
    };
  }

  private runQC1(command: string) {
    const root = getWorkspaceRoot();
    const config = this.getConfig();

    if (!root) {
      this.appendOutput("Aucun workspace ouvert.", "error");
      this.postStatus("No workspace", "error");
      return;
    }

    if (config.autoClearOutput) {
      this.clearOutput();
    }

    const quickCommandPath = getQuickCommandPath(this.context);
    const escapedCommand = command.replace(/"/g, '\\"');
    const fullCommand = os.platform() === "win32"
      ? `powershell -ExecutionPolicy Bypass -File "${quickCommandPath}" "${escapedCommand}"`
      : `chmod +x "${quickCommandPath}" && "${quickCommandPath}" "${escapedCommand}"`;

    this.postStatus(`Running: ${command}`, "running");
    this.appendOutput(`$ qc1 ${command}`, "command");

    exec(fullCommand, { cwd: root }, (error, stdout, stderr) => {
      if (stdout) this.appendOutput(stdout, "stdout");
      if (stderr) this.appendOutput(stderr, "stderr");

      if (error) {
        this.appendOutput(`Erreur: ${error.message}`, "error");
        this.postStatus(`Failed: ${command}`, "error");
      } else {
        this.postStatus(`Done: ${command}`, "success");
      }

      this.appendOutput("--- termine ---", "separator");
    });
  }

  private appendOutput(text: string, kind: string = "stdout") {
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

  public clearOutput() {
    this.outputLines = [];
    this.view?.webview.postMessage({ type: "clearOutput" });
    this.postStatus("Output cleared", "idle");
  }

  private postStatus(text: string, state: "idle" | "running" | "success" | "error") {
    this.view?.webview.postMessage({
      type: "status",
      text,
      state
    });
  }

  private sendSettings() {
    this.view?.webview.postMessage({
      type: "settings",
      settings: this.getConfig()
    });
  }

  private getHtml(): string {
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
      <div id="output">QC1 pret.</div>
      <div class="terminal">
        <input id="cmd2" placeholder="health" onkeydown="handleKey2(event)" />
        <button onclick="sendTerminal2()">Run</button>
      </div>
    </div>
  </section>

  <section id="settingsPanel" class="panel">
    <div class="card">
      <div class="card-title">Parametres QC1</div>

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
        Ces parametres sont stockes dans VSCode. Tu peux les modifier dans Settings, puis cliquer Refresh ici.
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
    if (output.textContent === "QC1 pret.") output.textContent = "";

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

export function activate(context: vscode.ExtensionContext) {
  const provider = new QC1PanelProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(QC1PanelProvider.viewType, provider)
  );

  context.subscriptions.push(vscode.commands.registerCommand("qc1.build", () => {
    runQuickCommand(context, ["make"]);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.clean", () => {
    runQuickCommand(context, ["clean"]);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.rebuild", () => {
    runQuickCommand(context, ["clean"]);
    runQuickCommand(context, ["make"]);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.tsmake", () => {
    runQuickCommand(context, ["tsmake"]);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.flash", () => {
    runQuickCommand(context, ["flash"]);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.run", () => {
    runQuickCommand(context, ["run"]);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.health", () => {
    runQuickCommand(context, ["health"]);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.status", () => {
    runQuickCommand(context, ["status"]);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.error", () => {
    runQuickCommand(context, ["error"]);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.detectStlink", () => {
    runQuickCommand(context, ["status"]);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.openSerial", () => {
    runQuickCommand(context, ["serial"]);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.startOpenOcd", () => {
    const terminal = vscode.window.createTerminal("QC1 OpenOCD");
    const openocdPath = vscode.workspace.getConfiguration("qc1").get<string>("openocdPath", "openocd");
    terminal.sendText(openocdPath);
    terminal.show();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.configure", () => {
    vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Mistral400.QC1-STM32-Tools qc1");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.refresh", () => {
    provider.clearOutput();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.dev", () => {
    runQuickCommand(context, ["dev"]);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.openSettings", () => {
    vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Mistral400.QC1-STM32-Tools");
  }));
}

export function deactivate() {}
