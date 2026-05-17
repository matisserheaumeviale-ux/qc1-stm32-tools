import * as vscode from "vscode";
import { exec } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  DashboardState,
  defaultDashboardState,
  startProgress,
  updateProgress,
  finishProgress
} from "./dashboard/dashboardState";
import { getDashboardHtml } from "./dashboard/dashboardHtml";
import { parseQc1Output } from "./qc1/qc1Parser";
import { LiixAiPanelProvider } from "./ai/aiPanel";

let dashboardState: DashboardState = defaultDashboardState;
let dashboardPanel: vscode.WebviewView | undefined;
let progressTimer: NodeJS.Timeout | undefined;
let outputChannel: vscode.OutputChannel | undefined;

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
    if (os.platform() === "win32") {
      const workspaceCmd = path.join(root, "scripts", "quick-command.cmd");
      const workspacePs1 = path.join(root, "scripts", "quick-command.ps1");

      if (fileExists(workspaceCmd)) {
        return workspaceCmd;
      }

      if (fileExists(workspacePs1)) {
        return workspacePs1;
      }
    } else {
      const workspaceScript = path.join(root, "scripts", "quick-command");

      if (fileExists(workspaceScript)) {
        return workspaceScript;
      }
    }
  }

  if (os.platform() === "win32") {
    const bundledCmd = path.join(context.extensionPath, "resources", "scripts", "quick-command.cmd");
    const bundledPs1 = path.join(context.extensionPath, "resources", "scripts", "quick-command.ps1");

    if (fileExists(bundledCmd)) {
      return bundledCmd;
    }

    if (fileExists(bundledPs1)) {
      return bundledPs1;
    }
  } else {
    const bundledScript = path.join(context.extensionPath, "resources", "scripts", "quick-command");

    if (fileExists(bundledScript)) {
      return bundledScript;
    }
  }

  return "quick-command";
}

function quoteArg(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function buildQuickCommandExec(commandPath: string, args: string[]): string {
  const quotedArgs = args.map(quoteArg).join(" ");

  if (os.platform() === "win32") {
    if (commandPath.toLowerCase().endsWith(".ps1")) {
      return `powershell -ExecutionPolicy Bypass -File "${commandPath}" ${quotedArgs}`.trim();
    }

    return `cmd /c ""${commandPath}" ${quotedArgs}"`.trim();
  }

  return `chmod +x "${commandPath}" && "${commandPath}" ${quotedArgs}`.trim();
}

function runQuickCommand(context: vscode.ExtensionContext, args: string[]) {
  const terminal = vscode.window.createTerminal("QC1 STM32");
  const quickCommand = getQuickCommandPath(context);
  terminal.sendText(buildQuickCommandExec(quickCommand, args));

  terminal.show();
}

function refreshDashboard() {
  if (dashboardPanel) {
    dashboardPanel.webview.html = getDashboardHtml(dashboardState);
  }
}

function startRuntimeTimer() {
  stopRuntimeTimer();

  progressTimer = setInterval(() => {
    if (!dashboardState.progress.active) {
      stopRuntimeTimer();
      return;
    }

    dashboardState = updateProgress(
      dashboardState,
      dashboardState.progress.progressPercent,
      dashboardState.progress.currentStep
    );

    refreshDashboard();
  }, 1000);
}

function stopRuntimeTimer() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = undefined;
  }
}

function syncDashboardState(context: vscode.ExtensionContext) {
  const status = getQc1Status(context);
  const projectRoot = status.projectPath || getWorkspaceRoot() || "";
  const buildDir = projectRoot ? path.join(projectRoot, "build") : "";
  const elfPath = buildDir ? path.join(buildDir, "firmware.elf") : "";
  const binPath = buildDir ? path.join(buildDir, "firmware.bin") : "";
  const bundledMakePath = path.join(context.extensionPath, "resources", "tools", "windows", "make.exe");
  const quickCommandPath = getQuickCommandPath(context);

  dashboardState = {
    ...dashboardState,
    projectName: projectRoot ? path.basename(projectRoot) : "--",
    project: {
      workspaceOpened: Boolean(getWorkspaceRoot()),
      projectDetected: status.projectOk,
      makefileFound: status.makefileOk,
      coreFolderFound: Boolean(projectRoot) && fileExists(path.join(projectRoot, "Core")),
      driversFolderFound: Boolean(projectRoot) && fileExists(path.join(projectRoot, "Drivers")),
      buildFolderFound: Boolean(buildDir) && fileExists(buildDir),
      elfFound: Boolean(elfPath) && fileExists(elfPath),
      binFound: Boolean(binPath) && fileExists(binPath)
    },
    environment: {
      ...dashboardState.environment,
      os: process.platform,
      extensionVersion: context.extension.packageJSON.version || defaultDashboardState.environment.extensionVersion,
      quickCommandPath,
      makePath: status.makePath || "--",
      bundledMakePath: fileExists(bundledMakePath) ? bundledMakePath : "--",
      offlinePortable: quickCommandPath.startsWith(context.extensionPath),
      gccDetected: status.compilerOk,
      openocdDetected: status.openocdOk,
      stlinkDetected: status.stFlashOk,
      makeDetected: status.makeOk,
      bundledMakeUsed: process.platform === "win32" && status.makeSource === "integre"
    }
  };
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
    dashboardPanel = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = getDashboardHtml(dashboardState);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "command":
          if (msg.command === "openLogs") {
            outputChannel?.show(true);
          } else {
            this.runQC1(msg.command);
          }
          break;

        case "run":
          this.runQC1(msg.command);
          break;

        case "terminal":
          this.runQC1(msg.command);
          break;

        case "clear":
          this.clearOutput();
          break;

        case "copyOutput":
          await vscode.env.clipboard.writeText(this.outputLines.join("\n"));
          this.postStatus("Output copied", "success");
          break;

        case "saveLog":
          await this.saveLog();
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

        case "openExtensionFolder":
          await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(this.context.extensionPath));
          break;

        case "openProjectFolder": {
          const root = getWorkspaceRoot();
          if (root) {
            await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(root));
          }
          break;
        }
      }
    });

    this.sendSettings();
    this.sendToolsStatus();
    this.sendTerminalMeta();
    this.sendAnalysis({
      errors: dashboardState.build.errors,
      warnings: dashboardState.build.warnings,
      hasBuildFailed: false,
      hasFlashFailed: false,
      elfGenerated: dashboardState.build.elfGenerated,
      binGenerated: dashboardState.build.binGenerated,
      flashUsage: dashboardState.build.flashUsage || "--",
      ramUsage: dashboardState.build.ramUsage || "--",
      diagnostics: [],
      explanation: "Aucune erreur connue detectee."
    });
    syncDashboardState(this.context);
    refreshDashboard();
    this.postStatus("Ready", "idle");
  }

  private getConfig() {
    const config = vscode.workspace.getConfiguration("qc1");

    return {
      quickCommandPath: getQuickCommandPath(this.context),
      os: process.platform,
      extensionVersion: this.context.extension.packageJSON.version || defaultDashboardState.environment.extensionVersion,
      projectPath: config.get<string>("projectPath", ""),
      makefilePath: config.get<string>("makefilePath", ""),
      compilerPath: config.get<string>("compilerPath", ""),
      openocdPath: config.get<string>("openocdPath", ""),
      autoClearOutput: config.get<boolean>("autoClearOutput", false),
      showTimestamps: config.get<boolean>("showTimestamps", true),
      outputMaxLines: config.get<number>("outputMaxLines", 500),
      compactMode: config.get<boolean>("compactMode", false),
      makeSource: getQc1Status(this.context).makeSource === "integre" ? "bundled" : "systeme",
      makePath: getQc1Status(this.context).makePath || "--",
      bundledMakePath: path.join(this.context.extensionPath, "resources", "tools", "windows", "make.exe"),
      offlinePortable: getQuickCommandPath(this.context).startsWith(this.context.extensionPath)
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
    syncDashboardState(this.context);
    refreshDashboard();
    this.postStatus("Paths auto-detected", "success");
  }

  private async saveLog() {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(getWorkspaceRoot() || this.context.extensionPath, "qc1-log.txt")),
      filters: {
        Text: ["txt", "log"]
      }
    });

    if (!uri) {
      return;
    }

    await fs.promises.writeFile(uri.fsPath, this.outputLines.join("\n"), "utf8");
    this.postStatus("Log saved", "success");
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
    const fullCommand = buildQuickCommandExec(quickCommandPath, [command]);
    const makeDir = toolStatus.makefileDir || toolStatus.projectPath || root;

    this.postStatus(`Running: ${command}`, "running");
    this.appendOutput(`$ qc1 ${command}`, "command");
    syncDashboardState(this.context);
    dashboardState = {
      ...dashboardState,
      lastCommand: command
    };
    this.sendTerminalMeta();

    dashboardState = startProgress(
      dashboardState,
      command,
      "Preparation de la commande"
    );
    refreshDashboard();
    startRuntimeTimer();

    dashboardState = updateProgress(dashboardState, 15, "Validation du projet");
    refreshDashboard();

    setTimeout(() => {
      dashboardState = updateProgress(dashboardState, 35, "Execution du script QC1");
      refreshDashboard();
    }, 500);

    setTimeout(() => {
      dashboardState = updateProgress(dashboardState, 70, "Traitement de la sortie");
      refreshDashboard();
    }, 1500);

    exec(fullCommand, {
      cwd: makeDir,
      env: buildQc1Env(this.context),
      encoding: "utf8"
    }, (error, stdout, stderr) => {
      if (stdout) this.appendOutput(stdout, "stdout");
      if (stderr) this.appendOutput(stderr, "stderr");
      const fullOutput = `${stdout ?? ""}\n${stderr ?? ""}`;
      const parsed = parseQc1Output(fullOutput);
      const runtimeMs = (dashboardState.progress.runtimeSeconds || 0) * 1000;

      dashboardState = {
        ...dashboardState,
        build: {
          ...dashboardState.build,
          errors: parsed.errors,
          warnings: parsed.warnings,
          flashUsage: parsed.flashUsage,
          ramUsage: parsed.ramUsage,
          elfGenerated: parsed.elfGenerated,
          binGenerated: parsed.binGenerated
        }
      };

      refreshDashboard();

      if (command === "make") {
        dashboardState = {
          ...dashboardState,
          build: {
            ...dashboardState.build,
            lastBuildTime: new Date().toLocaleString(),
            lastBuildSuccess: !error && !parsed.hasBuildFailed && parsed.errors === 0,
            buildRuntimeMs: runtimeMs,
            errors: parsed.errors,
            warnings: parsed.warnings,
            flashUsage: parsed.flashUsage,
            ramUsage: parsed.ramUsage,
            elfGenerated: parsed.elfGenerated,
            binGenerated: parsed.binGenerated
          }
        };
      }

      if (command === "flash") {
        dashboardState = {
          ...dashboardState,
          flash: {
            ...dashboardState.flash,
            lastFlashTime: new Date().toLocaleString(),
            lastFlashSuccess: !error && !parsed.hasFlashFailed,
            flashRuntimeMs: runtimeMs,
            method: fullOutput.toLowerCase().includes("openocd") ? "OpenOCD" : "st-flash",
            targetMCU: fullOutput.toLowerCase().includes("stm32f103") ? "STM32F103" : "--"
          }
        };
      }

      const success =
        !error &&
        parsed.errors === 0 &&
        !parsed.hasBuildFailed &&
        !parsed.hasFlashFailed;

      if (error) {
        dashboardState = finishProgress(
          dashboardState,
          success,
          command === "make" ? 202 : command === "flash" ? 203 : 201,
          command === "make" ? 500 : command === "flash" ? 501 : 504,
          command === "make" ? "BUILD_SUCCESS" : command === "flash" ? "FLASH_SUCCESS" : "COMMAND_DONE",
          command === "make" ? "BUILD_FAILED" : command === "flash" ? "FLASH_FAILED" : "EXECUTION_FAILED",
          success ? `${command} termine` : `${command} echoue`
        );
        refreshDashboard();
        stopRuntimeTimer();
        this.appendOutput(`Erreur: ${error.message}`, "error");
        this.postStatus(`Failed: ${command}`, "error");
      } else {
        dashboardState = finishProgress(
          dashboardState,
          success,
          command === "make" ? 202 : command === "flash" ? 203 : 201,
          command === "make" ? 500 : command === "flash" ? 501 : 504,
          command === "make" ? "BUILD_SUCCESS" : command === "flash" ? "FLASH_SUCCESS" : "COMMAND_DONE",
          command === "make" ? "BUILD_FAILED" : command === "flash" ? "FLASH_FAILED" : "EXECUTION_FAILED",
          success ? `${command} termine` : `${command} echoue`
        );
        refreshDashboard();
        stopRuntimeTimer();
        this.postStatus(success ? `Done: ${command}` : `Failed: ${command}`, success ? "success" : "error");
      }

      syncDashboardState(this.context);
      refreshDashboard();
      this.sendAnalysis(parsed);
      this.sendTerminalMeta();
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
    outputChannel?.appendLine(lines.join("\n"));

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
    this.sendAnalysis({
      errors: 0,
      warnings: 0,
      hasBuildFailed: false,
      hasFlashFailed: false,
      elfGenerated: false,
      binGenerated: false,
      flashUsage: "--",
      ramUsage: "--",
      diagnostics: [],
      explanation: "Aucune erreur connue detectee."
    });
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

  private sendTerminalMeta() {
    this.view?.webview.postMessage({
      type: "terminalMeta",
      meta: {
        projectName: dashboardState.projectName,
        lastCommand: dashboardState.lastCommand
      }
    });
  }

  private sendAnalysis(parsed: ReturnType<typeof parseQc1Output>) {
    this.view?.webview.postMessage({
      type: "analysis",
      analysis: {
        errors: parsed.errors,
        warnings: parsed.warnings,
        explanation: parsed.explanation,
        diagnostics: parsed.diagnostics
      }
    });
  }

}

function getWindowsToolsDir(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "resources", "tools", "windows");
}

function buildQc1Env(context: vscode.ExtensionContext): NodeJS.ProcessEnv {
  const env = { ...process.env };

  if (process.platform === "win32") {
    const windowsToolsDir = getWindowsToolsDir(context);
    const makeExe = path.join(windowsToolsDir, "make.exe");

    if (fs.existsSync(makeExe)) {
      env.PATH = `${windowsToolsDir};${env.PATH ?? ""}`;
    }
  }

  return env;
}
export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("QC1 STM32 Tools");
  context.subscriptions.push(outputChannel);
  syncDashboardState(context);

  const provider = new QC1PanelProvider(context.extensionUri, context);
  const aiProvider = new LiixAiPanelProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(QC1PanelProvider.viewType, provider)
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LiixAiPanelProvider.viewType, aiProvider)
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
