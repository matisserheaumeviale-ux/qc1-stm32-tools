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

function findMakefile(dir: string): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isFile() && entry.name === "Makefile") {
      return dir;
    }

    if (entry.isDirectory()) {
      try {
        const result = findMakefile(fullPath);
        if (result) {
          return result;
        }
      } catch {}
    }
  }

  return null;
}

function getPathCandidates(name: string): string[] {
  const pathValue = process.env.PATH || "";
  const directories = pathValue.split(path.delimiter).filter(Boolean);
  const extensions = os.platform() === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
        .split(";")
        .filter(Boolean)
    : [""];

  const candidates: string[] = [];

  for (const dir of directories) {
    if (os.platform() === "win32") {
      const lowerName = name.toLowerCase();
      const hasKnownExt = extensions.some((ext) => lowerName.endsWith(ext.toLowerCase()));

      if (hasKnownExt) {
        candidates.push(path.join(dir, name));
      } else {
        for (const ext of extensions) {
          candidates.push(path.join(dir, `${name}${ext}`));
        }
      }
    } else {
      candidates.push(path.join(dir, name));
    }
  }

  return candidates;
}

function findExecutable(name: string): string | null {
  for (const candidate of getPathCandidates(name)) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

type Qc1Status = {
  projectPath: string;
  makefileDir: string;
  projectOk: boolean;
  makefileOk: boolean;
  makePath: string;
  makeOk: boolean;
  makeSource: string;
  compilerPath: string;
  compilerOk: boolean;
  compilerSource: string;
  openocdPath: string;
  openocdOk: boolean;
  openocdSource: string;
  stFlashPath: string;
  stFlashOk: boolean;
  stFlashSource: string;
};

function getQc1Status(context: vscode.ExtensionContext): Qc1Status {
  const config = vscode.workspace.getConfiguration("qc1");
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";

  const projectPath = (config.get<string>("projectPath") || "").trim() || workspaceRoot;
  const makefilePathSetting = (config.get<string>("makefilePath") || "").trim();
  const compilerPathSetting = (config.get<string>("compilerPath") || "").trim();
  const openocdPathSetting = (config.get<string>("openocdPath") || "").trim();

  const makefileDir = makefilePathSetting || (projectPath ? findMakefile(projectPath) || "" : "");
  const bundledMake = path.join(context.extensionPath, "resources", "tools", "windows", "make.exe");
  const pathMake = findExecutable(os.platform() === "win32" ? "make.exe" : "make");
  const makePath = os.platform() === "win32"
    ? (fileExists(bundledMake) ? bundledMake : pathMake || "")
    : pathMake || "";
  const makeSource = os.platform() === "win32"
    ? (fileExists(bundledMake) ? "integre" : pathMake ? "PATH" : "introuvable")
    : pathMake ? "PATH" : "introuvable";

  const autoCompilerPath = findExecutable(os.platform() === "win32" ? "arm-none-eabi-gcc.exe" : "arm-none-eabi-gcc");
  const compilerPath = compilerPathSetting || autoCompilerPath || "";
  const compilerSource = compilerPathSetting ? "setting" : autoCompilerPath ? "PATH" : "introuvable";

  const autoOpenocdPath = findExecutable(os.platform() === "win32" ? "openocd.exe" : "openocd");
  const openocdPath = openocdPathSetting || autoOpenocdPath || "";
  const openocdSource = openocdPathSetting ? "setting" : autoOpenocdPath ? "PATH" : "introuvable";

  const autoStFlashPath = findExecutable(os.platform() === "win32" ? "st-flash.exe" : "st-flash");
  const stFlashPath = autoStFlashPath || "";
  const stFlashSource = autoStFlashPath ? "PATH" : "introuvable";

  return {
    projectPath,
    makefileDir,
    projectOk: Boolean(projectPath) && fileExists(projectPath),
    makefileOk: Boolean(makefileDir) && fileExists(path.join(makefileDir, "Makefile")),
    makePath,
    makeOk: Boolean(makePath),
    makeSource,
    compilerPath: compilerPath || "Not found",
    compilerOk: Boolean(compilerPath),
    compilerSource,
    openocdPath: openocdPath || "Not found",
    openocdOk: Boolean(openocdPath),
    openocdSource,
    stFlashPath: stFlashPath || "Not found",
    stFlashOk: Boolean(stFlashPath),
    stFlashSource
  };
}

function formatDiagnostic(status: Qc1Status): string {
  const lines = [
    "Status outils QC1",
    "",
    `Project Folder      ${status.projectOk ? "OK" : "Missing"}`,
    `Makefile            ${status.makefileOk ? "OK" : "Missing"}`,
    `Make                ${status.makeOk ? `OK ${status.makeSource}` : "Missing"}`,
    `ARM GCC             ${status.compilerOk ? `OK ${status.compilerSource}` : "Missing"}`,
    `OpenOCD             ${status.openocdOk ? `OK ${status.openocdSource}` : "Missing"}`,
    `ST-Flash            ${status.stFlashOk ? `OK ${status.stFlashSource}` : "Missing"}`,
    "",
    "Project folder:",
    status.projectPath || "Not found",
    "",
    "Makefile folder:",
    status.makefileDir || "Not found",
    "",
    "Make:",
    status.makePath || "Not found",
    "",
    "Compiler:",
    status.compilerPath || "Not found",
    "",
    "OpenOCD:",
    status.openocdPath || "Not found",
    "",
    "ST-Flash:",
    status.stFlashPath || "Not found"
  ];

  return lines.join("\n");
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

        case "refreshTools":
          this.sendToolsStatus();
          break;

        case "autoDetectPaths":
          await this.autoDetectPaths();
          break;

        case "copyDiagnostic":
          await vscode.env.clipboard.writeText(formatDiagnostic(getQc1Status(this.context)));
          this.postStatus("Diagnostic copied", "success");
          break;
      }
    });

    this.sendSettings();
    this.sendToolsStatus();
    this.postStatus("Ready", "idle");
  }

  private getConfig() {
    const config = vscode.workspace.getConfiguration("qc1");

    return {
      quickCommandPath: getQuickCommandPath(this.context),
      projectPath: config.get<string>("projectPath", ""),
      makefilePath: config.get<string>("makefilePath", ""),
      compilerPath: config.get<string>("compilerPath", ""),
      openocdPath: config.get<string>("openocdPath", ""),
      autoClearOutput: config.get<boolean>("autoClearOutput", false),
      showTimestamps: config.get<boolean>("showTimestamps", true),
      outputMaxLines: config.get<number>("outputMaxLines", 500),
      compactMode: config.get<boolean>("compactMode", false)
    };
  }

  private async autoDetectPaths() {
    const config = vscode.workspace.getConfiguration("qc1");
    const status = getQc1Status(this.context);
    const updates: Thenable<void>[] = [];

    updates.push(config.update("projectPath", status.projectOk ? status.projectPath : "", vscode.ConfigurationTarget.Workspace));
    updates.push(config.update("makefilePath", status.makefileOk ? status.makefileDir : "", vscode.ConfigurationTarget.Workspace));
    updates.push(config.update("compilerPath", status.compilerOk && status.compilerSource === "PATH" ? status.compilerPath : "", vscode.ConfigurationTarget.Workspace));
    updates.push(config.update("openocdPath", status.openocdOk && status.openocdSource === "PATH" ? status.openocdPath : "", vscode.ConfigurationTarget.Workspace));

    await Promise.all(updates);
    this.sendSettings();
    this.sendToolsStatus();
    this.postStatus("Paths auto-detected", "success");
  }

  private runQC1(command: string) {
    const root = getWorkspaceRoot();
    const config = this.getConfig();
    const toolStatus = getQc1Status(this.context);

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
    const makeDir = toolStatus.makefileDir || toolStatus.projectPath || root;

    this.postStatus(`Running: ${command}`, "running");
    this.appendOutput(`$ qc1 ${command}`, "command");

    exec(fullCommand, {
      cwd: makeDir,
      encoding: "utf8"
    }, (error, stdout, stderr) => {
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

  private sendToolsStatus() {
    this.view?.webview.postMessage({
      type: "toolsStatus",
      tools: getQc1Status(this.context)
    });
  }

  private getHtml(): string {
    return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <style>
:root {
  --qc1-bg: #0d1114;
  --qc1-card: #151a1f;
  --qc1-card-2: #1a2026;
  --qc1-border: #2a333b;
  --qc1-text: #f0f3f6;
  --qc1-muted: #aab2bb;

  --qc1-blue: #2f91c7;
  --qc1-green: #2fa866;
  --qc1-purple: #7a4fe0;
  --qc1-orange: #c78316;
  --qc1-red: #c9443f;
  --qc1-gray: #5f7480;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: var(--vscode-font-family);
  padding: 14px;
  background:
    radial-gradient(circle at top left, rgba(47,145,199,0.12), transparent 34%),
    linear-gradient(180deg, #07141b 0%, #081016 100%);
  color: var(--vscode-foreground);
  font-size: 13px;
  overflow-x: hidden;
}

.qc1-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}

.qc1-title {
  font-size: 32px;
  font-weight: 900;
  letter-spacing: -1px;
  line-height: 0.9;
}

.qc1-badge {
  flex: 0 0 auto;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
  background: rgba(96, 125, 139, 0.18);
  color: #c6d3da;
  border: 1px solid rgba(96, 125, 139, 0.55);
}

.qc1-badge.running {
  background: rgba(199, 131, 22, 0.18);
  color: #f4c672;
  border-color: rgba(199, 131, 22, 0.55);
}

.qc1-badge.success {
  background: rgba(47, 168, 102, 0.18);
  color: #82e6ad;
  border-color: rgba(47, 168, 102, 0.55);
}

.qc1-badge.error {
  background: rgba(201, 68, 63, 0.18);
  color: #ff9692;
  border-color: rgba(201, 68, 63, 0.55);
}

.qc1-tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}

.qc1-tab {
  min-width: 0;
  padding: 10px 6px;
  border-radius: 18px;
  border: 1px solid var(--qc1-border);
  background: #101417;
  color: var(--qc1-text);
  font-size: 15px;
  font-weight: 800;
  text-align: center;
  white-space: nowrap;
  cursor: pointer;
}

.qc1-tab.active {
  background: linear-gradient(135deg, #38a9df, #237ca8);
  border-color: #60c7f1;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14);
}

.panel {
  display: none;
}

.panel.active {
  display: block;
}

.qc1-card {
  background: linear-gradient(180deg, var(--qc1-card), var(--qc1-card-2));
  border: 1px solid var(--qc1-border);
  border-radius: 24px;
  padding: 20px;
  margin-bottom: 18px;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.28);
  width: 100%;
}

.qc1-card-title {
  font-size: 26px;
  font-weight: 900;
  margin: 0 0 18px 0;
  line-height: 1.05;
}

.qc1-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.qc1-btn {
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 16px 8px;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.13);
  color: white;
  font-size: 16px;
  line-height: 1.1;
  font-weight: 850;
  cursor: pointer;
  background: var(--qc1-blue);
  transition: transform 0.08s ease, filter 0.12s ease;
}

.qc1-btn:hover {
  filter: brightness(1.12);
  transform: translateY(-1px);
}

.qc1-btn:active {
  transform: translateY(0);
}

.qc1-btn.health {
  background: linear-gradient(135deg, #35b874, #218851);
}

.qc1-btn.status {
  background: linear-gradient(135deg, #38a9df, #237ca8);
}

.qc1-btn.build,
.qc1-btn.make {
  background: linear-gradient(135deg, #8a5cf0, #6237c7);
}

.qc1-btn.flash {
  background: linear-gradient(135deg, #dfa12b, #b16c0c);
}

.qc1-btn.errors {
  background: linear-gradient(135deg, #d9534f, #a8322e);
}

.qc1-btn.dev {
  background: linear-gradient(135deg, #718995, #4f6570);
}

.qc1-btn.clear {
  background: #101417;
  color: var(--qc1-text);
  border: 1px solid var(--qc1-border);
}

.qc1-note {
  color: var(--qc1-muted);
  line-height: 1.45;
  font-size: 13px;
  margin-bottom: 12px;
}

.qc1-terminal {
  height: 360px;
  max-height: 48vh;
  padding: 18px;
  border-radius: 22px;
  border: 1px solid var(--qc1-border);
  background: #05090a;
  color: #c9f7da;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 14px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow: auto;
  word-break: break-word;
}

.line.command { color: #60c7f1; }
.line.stderr { color: #ffc766; }
.line.error { color: #ff8580; }
.line.separator { color: #78838c; }
.line.stdout { color: #dce3e8; }

.qc1-input-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  margin-top: 14px;
}

.qc1-input {
  min-width: 0;
  width: 100%;
  min-height: 44px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid var(--qc1-border);
  background: #101417;
  color: var(--qc1-text);
  font-size: 15px;
}

.qc1-input:focus {
  outline: none;
  border-color: #55bde9;
}

.qc1-run {
  min-width: 92px;
  min-height: 44px;
  padding: 12px 18px;
  border-radius: 16px;
  border: 1px solid #60c7f1;
  background: linear-gradient(135deg, #38a9df, #237ca8);
  color: white;
  font-weight: 850;
  font-size: 16px;
  cursor: pointer;
}

.qc1-settings-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.qc1-setting-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255,255,255,0.12);
}

.qc1-setting-label {
  display: block;
  font-weight: 850;
  font-size: 15px;
  color: var(--qc1-text);
  margin-bottom: 8px;
}

.qc1-setting-value {
  color: var(--qc1-muted);
  font-size: 13px;
}

.qc1-path {
  max-height: 84px;
  overflow: auto;
  width: 100%;
  padding: 10px 12px;
  border-radius: 14px;
  background: #0b0f12;
  border: 1px solid var(--qc1-border);
  font-family: "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.35;
  word-break: break-word;
}

.qc1-actions-row {
  display: grid;
  grid-template-columns: 1fr 90px;
  gap: 8px;
  margin-top: 14px;
}

.qc1-tools-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.qc1-tool-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255,255,255,0.12);
}

.qc1-tool-label {
  font-weight: 850;
  font-size: 15px;
  color: var(--qc1-text);
}

.qc1-tool-state {
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 850;
  border: 1px solid rgba(255,255,255,0.12);
}

.qc1-tool-state.ok {
  color: #82e6ad;
  border-color: rgba(47, 168, 102, 0.55);
  background: rgba(47, 168, 102, 0.18);
}

.qc1-tool-state.missing {
  color: #ff9692;
  border-color: rgba(201, 68, 63, 0.55);
  background: rgba(201, 68, 63, 0.18);
}

@media (max-width: 360px) {
  body {
    padding: 10px;
  }

  .qc1-title {
    font-size: 28px;
  }

  .qc1-badge {
    font-size: 13px;
    padding: 7px 12px;
  }

  .qc1-tab {
    font-size: 13px;
    padding: 9px 4px;
  }

  .qc1-card {
    padding: 16px;
    border-radius: 22px;
  }

  .qc1-card-title {
    font-size: 23px;
  }

  .qc1-btn {
    font-size: 14px;
    padding: 14px 6px;
  }

  .qc1-terminal {
    height: 330px;
    font-size: 13px;
  }
}
  </style>
</head>
<body>
  <div class="qc1-header">
    <div class="qc1-title">QC1 STM32</div>
    <div id="status" class="qc1-badge idle">Ready</div>
  </div>

  <div class="qc1-tabs">
    <button class="qc1-tab active" onclick="showTab(event, 'dashboard')">Dashboard</button>
    <button class="qc1-tab" onclick="showTab(event, 'outputPanel')">Output</button>
    <button class="qc1-tab" onclick="showTab(event, 'settingsPanel')">Settings</button>
    <button class="qc1-tab" onclick="showTab(event, 'toolsPanel')">Tools</button>
  </div>

  <section id="dashboard" class="panel active">
    <div class="qc1-card">
      <div class="qc1-card-title">Actions rapides</div>
      <div class="qc1-grid">
        <button class="qc1-btn health" onclick="run('health')">Health</button>
        <button class="qc1-btn status" onclick="run('status')">Status</button>
        <button class="qc1-btn make" onclick="run('tsmake')">Test Make</button>
        <button class="qc1-btn build" onclick="run('make')">Build</button>
        <button class="qc1-btn flash" onclick="run('flash')">Flash</button>
        <button class="qc1-btn errors" onclick="run('error')">Errors</button>
        <button class="qc1-btn dev" onclick="run('dev')">Dev Mode</button>
        <button class="qc1-btn clear" onclick="clearOutput()">Clear</button>
      </div>
    </div>

    <div class="qc1-card">
      <div class="qc1-card-title">Mini terminal QC1</div>
      <div class="qc1-note">Commandes disponibles : make, health, status, tsmake, flash, error</div>
      <div class="qc1-input-row">
        <input id="cmd" class="qc1-input" placeholder="make" onkeydown="handleKey(event)" />
        <button class="qc1-run" onclick="sendTerminal()">Run</button>
      </div>
    </div>
  </section>

  <section id="outputPanel" class="panel">
    <div class="qc1-card">
      <div class="qc1-card-title">Sortie QC1</div>
      <div id="output" class="qc1-terminal">QC1 prêt.</div>
      <div class="qc1-input-row">
        <input id="cmd2" class="qc1-input" placeholder="health" onkeydown="handleKey2(event)" />
        <button class="qc1-run" onclick="sendTerminal2()">Run</button>
      </div>
    </div>
  </section>

  <section id="settingsPanel" class="panel">
    <div class="qc1-card">
      <div class="qc1-card-title">Paramètres QC1</div>

      <div class="qc1-settings-list">
        <div class="qc1-setting-row">
          <div class="qc1-setting-label">Quick Command Path</div>
          <div id="sPath" class="qc1-setting-value qc1-path"></div>
        </div>
        <div class="qc1-setting-row">
          <div class="qc1-setting-label">Auto-clear Output</div>
          <div id="sAutoClear" class="qc1-setting-value"></div>
        </div>
        <div class="qc1-setting-row">
          <div class="qc1-setting-label">Show Timestamps</div>
          <div id="sTimestamps" class="qc1-setting-value"></div>
        </div>
        <div class="qc1-setting-row">
          <div class="qc1-setting-label">Max Output Lines</div>
          <div id="sMaxLines" class="qc1-setting-value"></div>
        </div>
        <div class="qc1-setting-row">
          <div class="qc1-setting-label">Compact Mode</div>
          <div id="sCompact" class="qc1-setting-value"></div>
        </div>
      </div>

      <br>
      <button class="qc1-btn status" onclick="openSettings()">Open VSCode Settings</button>
      <button class="qc1-btn clear" onclick="refreshSettings()">Refresh</button>
    </div>

    <div class="qc1-card">
      <div class="qc1-card-title">Notes</div>
      <div class="qc1-note">
        Ces paramètres sont stockés dans VSCode. Tu peux les modifier dans Settings, puis cliquer Refresh ici.
      </div>
    </div>
  </section>

  <section id="toolsPanel" class="panel">
    <div class="qc1-card">
      <div class="qc1-card-title">Status outils QC1</div>

      <div class="qc1-tools-list">
        <div class="qc1-tool-row">
          <div class="qc1-tool-label">Dossier projet</div>
          <div id="toolProjectOk" class="qc1-tool-state missing">introuvable</div>
        </div>
        <div class="qc1-tool-row">
          <div class="qc1-tool-label">Makefile</div>
          <div id="toolMakefileOk" class="qc1-tool-state missing">introuvable</div>
        </div>
        <div class="qc1-tool-row">
          <div class="qc1-tool-label">Make</div>
          <div id="toolMakeOk" class="qc1-tool-state missing">introuvable</div>
        </div>
        <div class="qc1-tool-row">
          <div class="qc1-tool-label">Compilateur ARM</div>
          <div id="toolCompilerOk" class="qc1-tool-state missing">introuvable</div>
        </div>
        <div class="qc1-tool-row">
          <div class="qc1-tool-label">OpenOCD</div>
          <div id="toolOpenocdOk" class="qc1-tool-state missing">introuvable</div>
        </div>
        <div class="qc1-tool-row">
          <div class="qc1-tool-label">ST-Flash</div>
          <div id="toolStFlashOk" class="qc1-tool-state missing">introuvable</div>
        </div>
      </div>

      <br>
      <div class="qc1-setting-row">
        <div class="qc1-setting-label">Project folder</div>
        <div id="toolProjectPath" class="qc1-setting-value qc1-path"></div>
      </div>
      <div class="qc1-setting-row">
        <div class="qc1-setting-label">Makefile folder</div>
        <div id="toolMakefilePath" class="qc1-setting-value qc1-path"></div>
      </div>
      <div class="qc1-setting-row">
        <div class="qc1-setting-label">Make</div>
        <div id="toolMakePath" class="qc1-setting-value qc1-path"></div>
      </div>
      <div class="qc1-setting-row">
        <div class="qc1-setting-label">Compiler</div>
        <div id="toolCompilerPath" class="qc1-setting-value qc1-path"></div>
      </div>
      <div class="qc1-setting-row">
        <div class="qc1-setting-label">OpenOCD</div>
        <div id="toolOpenocdPath" class="qc1-setting-value qc1-path"></div>
      </div>
      <div class="qc1-setting-row">
        <div class="qc1-setting-label">ST-Flash</div>
        <div id="toolStFlashPath" class="qc1-setting-value qc1-path"></div>
      </div>

      <br>
      <div class="qc1-grid">
        <button class="qc1-btn status" onclick="refreshTools()">Refresh Status</button>
        <button class="qc1-btn clear" onclick="openSettings()">Open VSCode Settings</button>
        <button class="qc1-btn build" onclick="autoDetectPaths()">Auto-detect Paths</button>
        <button class="qc1-btn dev" onclick="copyDiagnostic()">Copy Diagnostic</button>
      </div>
    </div>
  </section>

<script>
  const vscode = acquireVsCodeApi();

  function showTab(event, id) {
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".qc1-tab").forEach(t => t.classList.remove("active"));
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

  function refreshTools() {
    vscode.postMessage({ type: "refreshTools" });
  }

  function autoDetectPaths() {
    vscode.postMessage({ type: "autoDetectPaths" });
  }

  function copyDiagnostic() {
    vscode.postMessage({ type: "copyDiagnostic" });
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
    el.className = "qc1-badge " + state;
  }

  function setSettings(settings) {
    document.getElementById("sPath").textContent = settings.quickCommandPath || "auto";
    document.getElementById("sAutoClear").textContent = settings.autoClearOutput;
    document.getElementById("sTimestamps").textContent = settings.showTimestamps;
    document.getElementById("sMaxLines").textContent = settings.outputMaxLines;
    document.getElementById("sCompact").textContent = settings.compactMode;
  }

  function setToolState(id, ok, label) {
    const el = document.getElementById(id);
    el.textContent = label;
    el.className = "qc1-tool-state " + (ok ? "ok" : "missing");
  }

  function setToolsStatus(tools) {
    setToolState("toolProjectOk", tools.projectOk, tools.projectOk ? "OK" : "introuvable");
    setToolState("toolMakefileOk", tools.makefileOk, tools.makefileOk ? "OK" : "introuvable");
    setToolState("toolMakeOk", tools.makeOk, tools.makeOk ? "OK" : "introuvable");
    setToolState("toolCompilerOk", tools.compilerOk, tools.compilerOk ? "OK" : "introuvable");
    setToolState("toolOpenocdOk", tools.openocdOk, tools.openocdOk ? "OK" : "introuvable");
    setToolState("toolStFlashOk", tools.stFlashOk, tools.stFlashOk ? "OK" : "introuvable");

    document.getElementById("toolProjectPath").textContent = tools.projectPath || "Not found";
    document.getElementById("toolMakefilePath").textContent = tools.makefileDir || "Not found";
    document.getElementById("toolMakePath").textContent = tools.makePath || "Not found";
    document.getElementById("toolCompilerPath").textContent = tools.compilerPath || "Not found";
    document.getElementById("toolOpenocdPath").textContent = tools.openocdPath || "Not found";
    document.getElementById("toolStFlashPath").textContent = tools.stFlashPath || "Not found";
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

    if (msg.type === "toolsStatus") {
      setToolsStatus(msg.tools);
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
    const openocdPath = getQc1Status(context).openocdOk
      ? getQc1Status(context).openocdPath
      : "openocd";
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
