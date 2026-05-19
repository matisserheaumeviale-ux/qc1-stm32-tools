import * as vscode from "vscode";
import { exec } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  DashboardState,
  defaultDashboardState,
  getOsLabel,
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
let stlinkProbeStatus: "OK" | "non détecté" | "non testé" = "non testé";

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
  if (!dir || !fileExists(dir)) {
    return null;
  }

  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

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

function getExistingSettingPath(config: vscode.WorkspaceConfiguration, key: string): string {
  const configuredPath = (config.get<string>(key) || "").trim();
  return configuredPath && fileExists(configuredPath) ? configuredPath : "";
}

type Qc1Status = {
  projectPath: string;
  makefileDir: string;
  makefilePath: string;
  corePath: string;
  driversPath: string;
  projectOk: boolean;
  projectComplete: boolean;
  makefileOk: boolean;
  coreOk: boolean;
  driversOk: boolean;
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
  stlinkProbeStatus: "OK" | "non détecté" | "non testé";
  stlinkProbeOk: boolean;
};

type Qc1DiagnosticInfo = {
  code: string;
  title: string;
  message: string;
  cause: string;
  checkedPath: string;
  level: "success" | "warning" | "error" | "info" | "idle";
};

type Qc1Error = {
  code: string;
  title: string;
  message: string;
  cause?: string;
  command?: string;
  cwd?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  path?: string;
};

function createQc1Error(input: Partial<Qc1Error>): Qc1Error {
  return {
    code: input.code || "QC1-EXT-001",
    title: input.title || "Erreur interne extension",
    message: input.message || "Une erreur inattendue est survenue.",
    cause: input.cause,
    command: input.command,
    cwd: input.cwd,
    exitCode: input.exitCode ?? null,
    stdout: input.stdout,
    stderr: input.stderr,
    path: input.path
  };
}

function getExitCode(error: unknown): number | null {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "number" ? code : null;
}

function isTimeoutError(error: unknown): boolean {
  const err = error as { killed?: boolean; signal?: string; message?: string };
  return Boolean(err?.killed && err.signal === "SIGTERM") || Boolean(err?.message?.toLowerCase().includes("timed out"));
}

function isAllowedQc1Command(command: string): boolean {
  return [
    "make",
    "build",
    "clean",
    "rebuild",
    "tsmake",
    "flash",
    "run",
    "health",
    "status",
    "error",
    "serial",
    "dev"
  ].includes(command);
}

function readStlinkProbeStatus(output: string): "OK" | "non détecté" | "non testé" {
  const lower = output.toLowerCase();

  if (
    lower.includes("no device found") ||
    lower.includes("no st-link") ||
    lower.includes("st-link not found") ||
    lower.includes("stlink not found") ||
    lower.includes("unable to connect") ||
    lower.includes("target voltage")
  ) {
    return "non détecté";
  }

  if (
    lower.includes("st-link") ||
    lower.includes("stlink") ||
    lower.includes("target voltage") ||
    lower.includes("device connected")
  ) {
    return "OK";
  }

  return "non testé";
}

function normalizeMakefileDir(configuredPath: string): string {
  if (!configuredPath || !fileExists(configuredPath)) {
    return "";
  }

  try {
    const stat = fs.statSync(configuredPath);
    return stat.isFile() ? path.dirname(configuredPath) : configuredPath;
  } catch {
    return "";
  }
}

function getQc1Status(context: vscode.ExtensionContext): Qc1Status {
  const config = vscode.workspace.getConfiguration("qc1");
  const workspaceRoot = getWorkspaceRoot() || "";

  const configuredProjectPath = (config.get<string>("projectPath") || "").trim();
  const configuredMakefilePath = (config.get<string>("makefilePath") || "").trim();
  const makefilePathSetting = normalizeMakefileDir(configuredMakefilePath);
  const compilerPathSetting = getExistingSettingPath(config, "compilerPath");
  const openocdPathSetting = getExistingSettingPath(config, "openocdPath");
  const projectPath = configuredProjectPath || workspaceRoot;
  const projectOk = Boolean(projectPath) && fileExists(projectPath);

  const makefileDir = makefilePathSetting || (projectOk ? findMakefile(projectPath) || "" : "");
  const makefilePath = makefileDir ? path.join(makefileDir, "Makefile") : projectPath ? path.join(projectPath, "Makefile") : "";
  const corePath = projectPath ? path.join(projectPath, "Core") : "";
  const driversPath = projectPath ? path.join(projectPath, "Drivers") : "";
  const makefileOk = Boolean(makefilePath) && fileExists(makefilePath);
  const coreOk = Boolean(corePath) && fileExists(corePath);
  const driversOk = Boolean(driversPath) && fileExists(driversPath);
  const bundledMake = path.join(context.extensionPath, "resources", "tools", "windows", "make.exe");
  const pathMake = findExecutable(os.platform() === "win32" ? "make.exe" : "make");
  const makePath = os.platform() === "win32"
    ? (fileExists(bundledMake) ? bundledMake : pathMake || "")
    : pathMake || "";
  const makeSource = os.platform() === "win32"
    ? (fileExists(bundledMake) ? "intégré" : pathMake ? "PATH" : "introuvable")
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
    makefilePath,
    corePath,
    driversPath,
    projectOk,
    projectComplete: projectOk && makefileOk && coreOk && driversOk,
    makefileOk,
    coreOk,
    driversOk,
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
    stFlashSource,
    stlinkProbeStatus,
    stlinkProbeOk: stlinkProbeStatus === "OK"
  };
}

function formatDiagnostic(status: Qc1Status): string {
  const projectDiagnostic = getProjectDiagnostic(status);
  const lines = [
    "Status outils QC1",
    "",
    `Diagnostic          ${projectDiagnostic.code} - ${projectDiagnostic.message}`,
    `Cause               ${projectDiagnostic.cause}`,
    `Chemin vérifié      ${projectDiagnostic.checkedPath}`,
    "",
    `Project Folder      ${status.projectOk ? "OK" : "Missing"}`,
    `Makefile            ${status.makefileOk ? "OK" : "Introuvable"}`,
    `Core                ${status.coreOk ? "OK" : "Introuvable"}`,
    `Drivers             ${status.driversOk ? "OK" : "Introuvable"}`,
    `Make                ${status.makeOk ? `OK ${status.makeSource}` : "Introuvable"}`,
    `ARM GCC             ${status.compilerOk ? `OK ${status.compilerSource}` : "Missing"}`,
    `OpenOCD             ${status.openocdOk ? `OK ${status.openocdSource}` : "Missing"}`,
    `st-flash installé  ${status.stFlashOk ? `OK ${status.stFlashSource}` : "Missing"}`,
    `Probe ST-Link       ${status.stlinkProbeStatus}`,
    "",
    "Project folder:",
    status.projectPath || "Not found",
    "",
    "Makefile folder:",
    status.makefileDir || "Not found",
    "",
    "Makefile path:",
    status.makefilePath || "Not found",
    "",
    "Core folder:",
    status.corePath || "Not found",
    "",
    "Drivers folder:",
    status.driversPath || "Not found",
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
    "st-flash:",
    status.stFlashPath || "Not found"
  ];

  return lines.join("\n");
}

function getProjectDiagnostic(status: Qc1Status): Qc1DiagnosticInfo {
  if (!status.projectOk) {
    return {
      code: "QC1-PATH-001",
      level: "error",
      title: "CHEMIN_PROJET_INVALIDE",
      message: "Chemin projet invalide",
      cause: "Workspace absent ou chemin configure invalide",
      checkedPath: status.projectPath || "--"
    };
  }

  if (!status.makefileOk) {
    return {
      code: "QC1-PRJ-001",
      level: "warning",
      title: "MAKEFILE_INTROUVABLE",
      message: "Makefile introuvable",
      cause: "Aucun Makefile trouve dans le projet",
      checkedPath: status.makefilePath || path.join(status.projectPath, "Makefile")
    };
  }

  if (!status.coreOk) {
    return {
      code: "QC1-PRJ-002",
      level: "warning",
      title: "CORE_INTROUVABLE",
      message: "Dossier Core introuvable",
      cause: "Le dossier Core est absent du projet",
      checkedPath: status.corePath || path.join(status.projectPath, "Core")
    };
  }

  if (!status.driversOk) {
    return {
      code: "QC1-PRJ-003",
      level: "warning",
      title: "DRIVERS_INTROUVABLE",
      message: "Dossier Drivers introuvable",
      cause: "Le dossier Drivers est absent du projet",
      checkedPath: status.driversPath || path.join(status.projectPath, "Drivers")
    };
  }

  if (!status.makeOk) {
    return {
      code: "QC1-TOOL-001",
      level: "error",
      title: "MAKE_INTROUVABLE",
      message: "make introuvable",
      cause: "Aucun exécutable make détecté",
      checkedPath: status.makePath || "PATH"
    };
  }

  return {
    code: "QC1-OK-001",
    level: "success",
    title: "PROJET_OK",
    message: "Projet OK",
    cause: "Workspace, Makefile, Core, Drivers et make valides",
    checkedPath: status.projectPath
  };
}

function getToolDiagnostic(status: Qc1Status, command: string): Qc1DiagnosticInfo | undefined {
  if (!status.makeOk && ["make", "build", "clean", "rebuild", "tsmake", "status"].includes(command)) {
    return {
      code: "QC1-TOOL-001",
      level: "error",
      title: "MAKE_INTROUVABLE",
      message: "make introuvable",
      cause: "La commande nécessite make, mais aucun exécutable make n'a été détecté",
      checkedPath: status.makePath || "PATH"
    };
  }

  if (!status.compilerOk && ["make", "build", "rebuild", "tsmake"].includes(command)) {
    return {
      code: "QC1-TOOL-002",
      level: "error",
      title: "GCC_ARM_INTROUVABLE",
      message: "arm-none-eabi-gcc introuvable",
      cause: "La commande nécessite le compilateur ARM GCC",
      checkedPath: status.compilerPath || "PATH"
    };
  }

  if (!status.openocdOk && command === "flash") {
    return {
      code: "QC1-TOOL-003",
      level: "error",
      title: "OPENOCD_INTROUVABLE",
      message: "OpenOCD introuvable",
      cause: "La commande flash peut nécessiter OpenOCD",
      checkedPath: status.openocdPath || "PATH"
    };
  }

  if (!status.stFlashOk && command === "flash") {
    return {
      code: "QC1-TOOL-004",
      level: "error",
      title: "ST_FLASH_INTROUVABLE",
      message: "st-flash introuvable",
      cause: "La commande flash peut nécessiter st-flash",
      checkedPath: status.stFlashPath || "PATH"
    };
  }

  return undefined;
}

function createQc1ErrorFromDiagnostic(
  diagnostic: Qc1DiagnosticInfo,
  command: string,
  cwd: string
): Qc1Error {
  return createQc1Error({
    code: diagnostic.code,
    title: diagnostic.title,
    message: diagnostic.message,
    cause: diagnostic.cause,
    command,
    cwd,
    path: diagnostic.checkedPath
  });
}

function createQc1ErrorFromProcess(
  error: unknown,
  command: string,
  cwd: string,
  stdout: string,
  stderr: string
): Qc1Error {
  if (isTimeoutError(error)) {
    return createQc1Error({
      code: "QC1-CMD-002",
      title: "COMMANDE_EXPIREE",
      message: "Commande expiree",
      cause: (error as Error)?.message || "La commande a depasse le delai permis",
      command,
      cwd,
      exitCode: getExitCode(error),
      stdout,
      stderr
    });
  }

  if (error) {
    return createQc1Error({
      code: "QC1-CMD-001",
      title: "COMMANDE_ECHOUEE",
      message: "Commande échouée",
      cause: stderr.trim() || (error as Error)?.message || "La commande QC1 a retourné une erreur",
      command,
      cwd,
      exitCode: getExitCode(error),
      stdout,
      stderr
    });
  }

  return createQc1Error({
    code: "QC1-EXT-001",
    title: "ERREUR_INTERNE_EXTENSION",
    message: "Erreur interne extension",
    cause: "La commande a produit un résultat invalide sans erreur système",
    command,
    cwd,
    stdout,
    stderr
  });
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
  const diagnostic = getProjectDiagnostic(status);
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
      workspaceOpened: status.projectOk,
      projectDetected: status.projectComplete,
      projectStatus: !status.projectOk ? "ERREUR" : status.projectComplete ? "OK" : "PARTIEL",
      makefileFound: status.makefileOk,
      coreFolderFound: status.coreOk,
      driversFolderFound: status.driversOk,
      buildFolderFound: Boolean(buildDir) && fileExists(buildDir),
      elfFound: Boolean(elfPath) && fileExists(elfPath),
      binFound: Boolean(binPath) && fileExists(binPath),
      workspacePath: status.projectPath || "--",
      makefilePath: status.makefilePath || "--",
      corePath: status.corePath || "--",
      driversPath: status.driversPath || "--"
    },
    environment: {
      ...dashboardState.environment,
      os: getOsLabel(process.platform),
      osRaw: process.platform,
      extensionVersion: context.extension.packageJSON.version || defaultDashboardState.environment.extensionVersion,
      quickCommandPath,
      makePath: status.makePath || "--",
      bundledMakePath: fileExists(bundledMakePath) ? bundledMakePath : "--",
      offlinePortable: quickCommandPath.startsWith(context.extensionPath),
      gccDetected: status.compilerOk,
      openocdDetected: status.openocdOk,
      stlinkDetected: status.stlinkProbeOk,
      stFlashInstalled: status.stFlashOk,
      stlinkProbeStatus: status.stlinkProbeStatus,
      makeDetected: status.makeOk,
      bundledMakeUsed: process.platform === "win32" && status.makeSource === "intégré"
    },
    diagnostic: {
      ...dashboardState.diagnostic,
      code: diagnostic.code,
      level: diagnostic.level,
      title: diagnostic.title,
      message: diagnostic.message,
      cause: diagnostic.cause,
      checkedPath: diagnostic.checkedPath
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
      explanation: "Aucune erreur connue détectée."
    });
    syncDashboardState(this.context);
    refreshDashboard();
    this.postStatus("Ready", "idle");
  }

  private getConfig() {
    const config = vscode.workspace.getConfiguration("qc1");

    return {
      quickCommandPath: getQuickCommandPath(this.context),
      os: getOsLabel(process.platform),
      osRaw: process.platform,
      extensionVersion: this.context.extension.packageJSON.version || defaultDashboardState.environment.extensionVersion,
      projectPath: config.get<string>("projectPath", ""),
      makefilePath: config.get<string>("makefilePath", ""),
      compilerPath: config.get<string>("compilerPath", ""),
      openocdPath: config.get<string>("openocdPath", ""),
      autoClearOutput: config.get<boolean>("autoClearOutput", false),
      showTimestamps: config.get<boolean>("showTimestamps", true),
      outputMaxLines: config.get<number>("outputMaxLines", 500),
      compactMode: config.get<boolean>("compactMode", false),
      makeSource: getQc1Status(this.context).makeSource === "intégré" ? "intégré" : "système",
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
    this.postStatus("Chemins détectés", "success");
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
      const qc1Error = createQc1Error({
        code: "QC1-PATH-001",
        title: "CHEMIN_PROJET_INVALIDE",
        message: "Chemin projet invalide",
        cause: "Aucun workspace ouvert",
        command,
        cwd: "--",
        path: toolStatus.projectPath || "--"
      });
      this.applyQc1Error(qc1Error);
      this.appendQc1Error(qc1Error, "projet");
      this.postStatus("No workspace", "error");
      return;
    }

    if (config.autoClearOutput) {
      this.clearOutput();
    }

    const quickCommandPath = getQuickCommandPath(this.context);
    const fullCommand = buildQuickCommandExec(quickCommandPath, [command]);
    const makeDir = toolStatus.makefileDir || toolStatus.projectPath || root;
    const displayedCommand = `qc1 ${command}`;

    this.postStatus(`Running: ${command}`, "running");
    this.appendOutput(`$ ${displayedCommand}`, "command");
    this.appendOutput(`CWD: ${makeDir}`, "command");
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

    if (!isAllowedQc1Command(command)) {
      const qc1Error = createQc1Error({
        code: "QC1-CMD-003",
        title: "COMMANDE_NON_AUTORISEE",
        message: "Commande non autorisee",
        cause: `La commande '${command}' n'est pas autorisee par QC1 STM32 Tools`,
        command: fullCommand,
        cwd: makeDir,
        path: quickCommandPath
      });
      dashboardState = {
        ...dashboardState,
        progress: {
          ...dashboardState.progress,
          active: false,
          currentStep: qc1Error.message
        }
      };
      stopRuntimeTimer();
      this.applyQc1Error(qc1Error);
      this.appendQc1Error(qc1Error, "commande");
      this.sendQc1ErrorAnalysis(qc1Error);
      refreshDashboard();
      this.postStatus(qc1Error.message, "error");
      this.appendOutput("--- terminé ---", "separator");
      return;
    }

    const projectDiagnostic = getProjectDiagnostic(toolStatus);
    const toolDiagnostic = getToolDiagnostic(toolStatus, command);
    const blockingDiagnostic = projectDiagnostic.code === "QC1-OK-001" ? toolDiagnostic : projectDiagnostic;
    const shouldRunExternalCommand = !blockingDiagnostic;

    if (!shouldRunExternalCommand) {
      const qc1Error = createQc1ErrorFromDiagnostic(blockingDiagnostic, fullCommand, makeDir);
      const blockingLevel = blockingDiagnostic.level === "warning" ? "warning" : "error";
      dashboardState = {
        ...dashboardState,
        currentAction: blockingLevel === "error" ? "Erreur" : "Diagnostic projet",
        progress: {
          ...dashboardState.progress,
          active: false,
          progressPercent: dashboardState.progress.progressPercent,
          currentStep: qc1Error.message
        }
      };

      stopRuntimeTimer();
      this.applyQc1Error(qc1Error, blockingLevel);
      this.appendQc1Error(qc1Error, blockingDiagnostic.code.startsWith("QC1-PRJ") ? "projet" : "outil");
      this.sendQc1ErrorAnalysis(qc1Error, blockingLevel);
      refreshDashboard();
      this.sendTerminalMeta();
      this.postStatus(qc1Error.message, "error");
      this.appendOutput("--- terminé ---", "separator");
      return;
    }

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
      encoding: "utf8",
      timeout: 120000
    }, (error, stdout, stderr) => {
      const stdoutText = stdout ?? "";
      const stderrText = stderr ?? "";
      const fullOutput = `${stdoutText}\n${stderrText}`;
      const detectedProbeStatus = readStlinkProbeStatus(fullOutput);
      if (detectedProbeStatus !== "non testé") {
        stlinkProbeStatus = detectedProbeStatus;
      }
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
      let commandError: Qc1Error | undefined;

      if (error) {
        const qc1Error = createQc1ErrorFromProcess(error, fullCommand, makeDir, stdoutText, stderrText);
        commandError = qc1Error;
        dashboardState = finishProgress(
          dashboardState,
          success,
          "QC1-CMD-OK",
          qc1Error.code,
          command === "make" ? "BUILD_SUCCESS" : command === "flash" ? "FLASH_SUCCESS" : "COMMAND_DONE",
          qc1Error.title,
          success ? `${command} terminé` : qc1Error.message,
          qc1Error.cause || "La commande QC1 a retourné une erreur",
          makeDir
        );
        refreshDashboard();
        stopRuntimeTimer();
        this.appendQc1Error(qc1Error, "commande");
        this.postStatus(`Failed: ${command}`, "error");
      } else {
        const failureCause = parsed.explanation || "La commande QC1 a retourné un résultat invalide";
        const qc1Error = success
          ? undefined
          : createQc1Error({
              code: "QC1-CMD-001",
              title: "COMMANDE_ECHOUEE",
              message: "Commande échouée",
              cause: failureCause,
              command: fullCommand,
              cwd: makeDir,
              exitCode: 0,
              stdout: stdoutText,
              stderr: stderrText
            });
        commandError = qc1Error;
        dashboardState = finishProgress(
          dashboardState,
          success,
          "QC1-CMD-OK",
          qc1Error?.code || "QC1-CMD-001",
          command === "make" ? "BUILD_SUCCESS" : command === "flash" ? "FLASH_SUCCESS" : "COMMAND_DONE",
          qc1Error?.title || "COMMANDE_ECHOUEE",
          success ? `${command} terminé` : qc1Error?.message || "Commande échouée",
          success ? "Commande terminée sans erreur détectée" : failureCause,
          makeDir
        );
        refreshDashboard();
        stopRuntimeTimer();
        if (success) {
          this.appendQc1CommandResult(fullCommand, makeDir, 0, stdoutText, stderrText);
        } else if (qc1Error) {
          this.appendQc1Error(qc1Error, "commande");
        }
        this.postStatus(success ? `Done: ${command}` : `Failed: ${command}`, success ? "success" : "error");
      }

      syncDashboardState(this.context);
      if (commandError) {
        this.applyQc1Error(commandError);
      }
      refreshDashboard();
      this.sendAnalysis(parsed);
      this.sendTerminalMeta();
      this.appendOutput("--- terminé ---", "separator");
    });
  }

  private applyQc1Error(qc1Error: Qc1Error, level: "warning" | "error" = "error") {
    dashboardState = {
      ...dashboardState,
      currentAction: level === "error" ? "Erreur" : "Diagnostic projet",
      diagnostic: {
        code: qc1Error.code,
        level,
        title: qc1Error.title,
        message: qc1Error.message,
        cause: qc1Error.cause || "--",
        checkedPath: qc1Error.path || qc1Error.cwd || "--"
      }
    };
  }

  private appendQc1Error(qc1Error: Qc1Error, kind: "projet" | "outil" | "commande" | "extension") {
    const header = kind === "projet"
      ? "[QC1] Erreur projet"
      : kind === "outil"
        ? "[QC1] Erreur outil"
        : kind === "commande"
          ? "[QC1] Commande échouée"
          : "[QC1] Erreur extension";

    const lines = [
      header,
      `Code    : ${qc1Error.code}`,
      `Message : ${qc1Error.message}`
    ];

    if (qc1Error.command) {
      lines.push(`Commande: ${qc1Error.command}`);
    }

    if (qc1Error.cwd) {
      lines.push(`CWD     : ${qc1Error.cwd}`);
    }

    if (qc1Error.exitCode !== undefined) {
      lines.push(`Exit    : ${qc1Error.exitCode === null ? "--" : qc1Error.exitCode}`);
    }

    if (qc1Error.path) {
      lines.push(`Chemin  : ${qc1Error.path}`);
    }

    if (qc1Error.cause) {
      lines.push(`Cause   : ${qc1Error.cause}`);
    }

    if (qc1Error.stdout !== undefined || qc1Error.stderr !== undefined) {
      lines.push("", "--- stdout ---", qc1Error.stdout?.trim() || "--", "", "--- stderr ---", qc1Error.stderr?.trim() || "--");
    }

    this.appendOutput(lines.join("\n"), "error");
  }

  private appendQc1CommandResult(
    command: string,
    cwd: string,
    exitCode: number | null,
    stdout: string,
    stderr: string
  ) {
    const lines = [
      "[QC1] Commande terminée",
      "Code    : QC1-CMD-OK",
      "Message : Commande terminée",
      `Commande: ${command}`,
      `CWD     : ${cwd}`,
      `Exit    : ${exitCode === null ? "--" : exitCode}`,
      "",
      "--- stdout ---",
      stdout.trim() || "--",
      "",
      "--- stderr ---",
      stderr.trim() || "--"
    ];

    this.appendOutput(lines.join("\n"), "stdout");
  }

  private sendQc1ErrorAnalysis(qc1Error: Qc1Error, level: "warning" | "error" = "error") {
    this.sendAnalysis({
      errors: level === "error" ? 1 : 0,
      warnings: level === "warning" ? 1 : 0,
      hasBuildFailed: false,
      hasFlashFailed: false,
      elfGenerated: dashboardState.build.elfGenerated,
      binGenerated: dashboardState.build.binGenerated,
      flashUsage: dashboardState.build.flashUsage || "--",
      ramUsage: dashboardState.build.ramUsage || "--",
      diagnostics: [{
        severity: level,
        message: qc1Error.message,
        raw: `${qc1Error.code} ${qc1Error.message}${qc1Error.path ? ` - Chemin: ${qc1Error.path}` : ""}`
      }],
        explanation: `${qc1Error.cause || qc1Error.message}${qc1Error.path ? `. Chemin vérifié: ${qc1Error.path}` : ""}`
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
      explanation: "Aucune erreur connue détectée."
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
      env.PATH = `${windowsToolsDir}${path.delimiter}${env.PATH ?? ""}`;
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
