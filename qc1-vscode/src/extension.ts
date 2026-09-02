import * as vscode from "vscode";
import { exec, execFile } from "child_process";
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
import {
  findStm32Project,
  inspectStm32Project,
  Qc1ProjectLayout,
  resolveConfiguredProjectPath
} from "./qc1/projectDiscovery";
import {
  getOpenOcdProgramArgs,
  getOpenOcdServerArgs,
  getStFlashWriteArgs,
  readStlinkProbeStatus
} from "./qc1/hardware";
import {
  buildDiagnosticReport,
  DiagnosticToolReport
} from "./qc1/diagnosticReport";

let dashboardState: DashboardState = defaultDashboardState;
let dashboardPanel: vscode.WebviewView | undefined;
let progressTimer: NodeJS.Timeout | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let stlinkProbeStatus: "OK" | "non détecté" | "non testé" = "non testé";
let embeddedCmakePath = "";
let embeddedGccPath = "";
let embeddedNinjaPath = "";

type EmbeddedBuildToolsApi = {
  ensureToolsInstalled(): Promise<boolean>;
  getCmakePath(): Promise<string | undefined>;
  getGccPath(): Promise<string | undefined>;
  getNinjaPath(): Promise<string | undefined>;
};

async function initializeEmbeddedBuildTools(): Promise<void> {
  const extension = vscode.extensions.getExtension<EmbeddedBuildToolsApi>("mylonics.embedded-build-tools");
  if (!extension) {
    return;
  }

  try {
    const api = await extension.activate();
    if (!await api.ensureToolsInstalled()) {
      return;
    }

    embeddedCmakePath = await api.getCmakePath() || "";
    embeddedGccPath = await api.getGccPath() || "";
    embeddedNinjaPath = await api.getNinjaPath() || "";
  } catch (error) {
    outputChannel?.appendLine(`[QC1] Outils embarqués indisponibles: ${(error as Error).message}`);
  }
}

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

function getExecutableSettingPath(
  config: vscode.WorkspaceConfiguration,
  key: string,
  fallbackName: string
): string {
  const configured = (config.get<string>(key) || "").trim();
  if (configured) {
    if (fileExists(configured)) return configured;
    const configuredFromPath = findExecutable(configured);
    if (configuredFromPath) return configuredFromPath;
  }

  return findExecutable(fallbackName) || "";
}

function findSerialPort(configuredPort: string): string {
  if (configuredPort) return configuredPort;
  if (os.platform() === "win32") return "";

  const patterns = os.platform() === "darwin"
    ? [/^cu\.usb/i, /^tty\.usb/i]
    : [/^ttyACM\d+$/i, /^ttyUSB\d+$/i];

  try {
    const device = fs.readdirSync("/dev").sort().find((name) => patterns.some((pattern) => pattern.test(name)));
    return device ? path.join("/dev", device) : "";
  } catch {
    return "";
  }
}

type Qc1Status = {
  projectPath: string;
  projectLayout: Qc1ProjectLayout;
  projectName: string;
  cmakeSourcePath: string;
  buildPath: string;
  elfPath: string;
  binPath: string;
  corePath: string;
  driversPath: string;
  sourcePath: string;
  startupPath: string;
  linkerScriptPath: string;
  projectOk: boolean;
  projectComplete: boolean;
  cmakeProjectReady: boolean;
  nativeCmakeOk: boolean;
  bundledCmakeReady: boolean;
  coreOk: boolean;
  driversOk: boolean;
  sourceOk: boolean;
  startupOk: boolean;
  linkerScriptOk: boolean;
  cmakePath: string;
  cmakeOk: boolean;
  cmakeSource: string;
  ninjaPath: string;
  ninjaOk: boolean;
  ninjaSource: string;
  compilerPath: string;
  compilerOk: boolean;
  compilerSource: string;
  openocdPath: string;
  openocdOk: boolean;
  openocdSource: string;
  stFlashPath: string;
  stFlashOk: boolean;
  stFlashSource: string;
  stlinkPath: string;
  stlinkToolOk: boolean;
  serialPort: string;
  baudRate: number;
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
    exitCode: input.exitCode,
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

function getQc1Status(context: vscode.ExtensionContext): Qc1Status {
  const config = vscode.workspace.getConfiguration("qc1");
  const workspaceRoot = getWorkspaceRoot() || "";

  const configuredProjectPath = (config.get<string>("projectPath") || "").trim();
  const autoDetectProject = config.get<boolean>("autoDetectProject", true);
  const configuredCmakePath = getExistingSettingPath(config, "cmakePath");
  const compilerPathSetting = getExistingSettingPath(config, "compilerPath");
  const openocdPathSetting = getExistingSettingPath(config, "openocdPath");
  const requestedProjectPath = workspaceRoot
    ? resolveConfiguredProjectPath(configuredProjectPath, workspaceRoot)
    : configuredProjectPath;
  const detectedProject = !configuredProjectPath && autoDetectProject && requestedProjectPath && fileExists(requestedProjectPath)
    ? findStm32Project(requestedProjectPath)
    : null;
  const projectInspection = detectedProject || (requestedProjectPath
    ? inspectStm32Project(requestedProjectPath)
    : inspectStm32Project(""));
  const projectPath = projectInspection.root;
  const projectOk = Boolean(projectPath) && fileExists(projectPath) && projectInspection.layout !== "unknown";
  const corePath = projectInspection.corePath;
  const driversPath = projectInspection.driversPath;
  const sourcePath = projectInspection.srcPath;
  const startupPath = projectInspection.startupPath;
  const linkerScriptPath = projectInspection.linkerScriptPath;
  const coreOk = Boolean(corePath) && fileExists(corePath);
  const driversOk = Boolean(driversPath) && fileExists(driversPath);
  const sourceOk = Boolean(sourcePath) && fileExists(sourcePath);
  const startupOk = Boolean(startupPath) && fileExists(startupPath);
  const linkerScriptOk = Boolean(linkerScriptPath) && fileExists(linkerScriptPath);
  const bundledCmakeSourcePath = path.join(context.extensionPath, "resources", "cmake");
  const nativeCmakeOk = Boolean(projectInspection.nativeCmakePath) && fileExists(projectInspection.nativeCmakePath);
  const bundledCmakeReady = fileExists(path.join(bundledCmakeSourcePath, "CMakeLists.txt")) &&
    fileExists(path.join(bundledCmakeSourcePath, "arm-none-eabi-toolchain.cmake"));
  const cmakeSourcePath = nativeCmakeOk ? projectPath : bundledCmakeSourcePath;
  const cmakeProjectReady = nativeCmakeOk || bundledCmakeReady;
  const buildDirectory = config.get<string>("buildDirectory", "build/qc1").trim() || "build/qc1";
  const buildPath = projectPath
    ? (path.isAbsolute(buildDirectory) ? buildDirectory : path.join(projectPath, buildDirectory))
    : "";
  const outputName = nativeCmakeOk ? projectInspection.projectName : "firmware";
  const elfPath = buildPath ? path.join(buildPath, `${outputName}.elf`) : "";
  const binPath = buildPath ? path.join(buildPath, `${outputName}.bin`) : "";
  const pathCmake = findExecutable(os.platform() === "win32" ? "cmake.exe" : "cmake");
  const cmakePath = configuredCmakePath || embeddedCmakePath || pathCmake || "";
  const cmakeSource = configuredCmakePath ? "setting" : embeddedCmakePath ? "extension" : pathCmake ? "PATH" : "introuvable";
  const pathNinja = findExecutable(os.platform() === "win32" ? "ninja.exe" : "ninja");
  const ninjaPath = embeddedNinjaPath || pathNinja || "";
  const ninjaSource = embeddedNinjaPath ? "extension" : pathNinja ? "PATH" : "introuvable";

  const autoCompilerPath = findExecutable(os.platform() === "win32" ? "arm-none-eabi-gcc.exe" : "arm-none-eabi-gcc");
  const compilerPath = compilerPathSetting || embeddedGccPath || autoCompilerPath || "";
  const compilerSource = compilerPathSetting ? "setting" : embeddedGccPath ? "extension" : autoCompilerPath ? "PATH" : "introuvable";

  const autoOpenocdPath = findExecutable(os.platform() === "win32" ? "openocd.exe" : "openocd");
  const openocdPath = openocdPathSetting || autoOpenocdPath || "";
  const openocdSource = openocdPathSetting ? "setting" : autoOpenocdPath ? "PATH" : "introuvable";

  const autoStFlashPath = findExecutable(os.platform() === "win32" ? "st-flash.exe" : "st-flash");
  const stFlashPath = autoStFlashPath || "";
  const stFlashSource = autoStFlashPath ? "PATH" : "introuvable";
  const stlinkPath = getExecutableSettingPath(config, "stlinkPath", os.platform() === "win32" ? "st-info.exe" : "st-info");
  const serialPort = findSerialPort((config.get<string>("serialPort") || "").trim());
  const baudRate = config.get<number>("baudRate", 19200);
  const projectComplete = projectOk && sourceOk && startupOk && linkerScriptOk && cmakeProjectReady;

  return {
    projectPath,
    projectLayout: projectInspection.layout,
    projectName: projectInspection.projectName,
    cmakeSourcePath,
    buildPath,
    elfPath,
    binPath,
    corePath,
    driversPath,
    sourcePath,
    startupPath,
    linkerScriptPath,
    projectOk,
    projectComplete,
    cmakeProjectReady,
    nativeCmakeOk,
    bundledCmakeReady,
    coreOk,
    driversOk,
    sourceOk,
    startupOk,
    linkerScriptOk,
    cmakePath: cmakePath || "Not found",
    cmakeOk: Boolean(cmakePath),
    cmakeSource,
    ninjaPath: ninjaPath || "Not found",
    ninjaOk: Boolean(ninjaPath),
    ninjaSource,
    compilerPath: compilerPath || "Not found",
    compilerOk: Boolean(compilerPath),
    compilerSource,
    openocdPath: openocdPath || "Not found",
    openocdOk: Boolean(openocdPath),
    openocdSource,
    stFlashPath: stFlashPath || "Not found",
    stFlashOk: Boolean(stFlashPath),
    stFlashSource,
    stlinkPath: stlinkPath || "Not found",
    stlinkToolOk: Boolean(stlinkPath),
    serialPort,
    baudRate,
    stlinkProbeStatus,
    stlinkProbeOk: stlinkProbeStatus === "OK"
  };
}

function formatDiagnostic(status: Qc1Status): string {
  const projectDiagnostics = getProjectDiagnostics(status);
  const diagnosticLines = projectDiagnostics.length > 0
    ? projectDiagnostics.map((diagnostic) =>
        `${diagnostic.code} [${diagnostic.level}] ${diagnostic.message} — ${diagnostic.checkedPath}`)
    : ["QC1-OK-001 [success] Projet OK"];
  const lines = [
    "Status outils QC1",
    "",
    "Diagnostics projet",
    ...diagnosticLines,
    "",
    `Project Folder      ${status.projectOk ? "OK" : "Missing"}`,
    `Structure           ${status.projectLayout}`,
    `CMake utilisé       ${status.nativeCmakeOk ? "projet natif" : status.bundledCmakeReady ? "QC1 intégré" : "Introuvable"}`,
    `Sources             ${status.sourceOk ? "OK" : "Introuvable"}`,
    `Core                ${status.coreOk ? "OK" : "optionnel/absent"}`,
    `Drivers             ${status.driversOk ? "OK" : "optionnel/absent"}`,
    `Startup STM32F103   ${status.startupOk ? "OK" : "Introuvable"}`,
    `Linker script       ${status.linkerScriptOk ? "OK" : "Introuvable"}`,
    `CMake               ${status.cmakeOk ? `OK ${status.cmakeSource}` : "Introuvable"}`,
    `Ninja               ${status.ninjaOk ? `OK ${status.ninjaSource}` : "Introuvable"}`,
    `ARM GCC             ${status.compilerOk ? `OK ${status.compilerSource}` : "Missing"}`,
    `OpenOCD             ${status.openocdOk ? `OK ${status.openocdSource}` : "Missing"}`,
    `st-flash installé  ${status.stFlashOk ? `OK ${status.stFlashSource}` : "Missing"}`,
    `st-info             ${status.stlinkToolOk ? "OK" : "Missing"}`,
    `Probe ST-Link       ${status.stlinkProbeStatus}`,
    `Port série          ${status.serialPort || "Non configuré/détecté"}`,
    "",
    "Project folder:",
    status.projectPath || "Not found",
    "",
    "CMake source intégré:",
    status.cmakeSourcePath || "Not found",
    "",
    "CMake build:",
    status.buildPath || "Not found",
    "",
    "Firmware ELF:",
    status.elfPath || "Not found",
    "",
    "Sources:",
    status.sourcePath || "Not found",
    "",
    "Core folder:",
    status.corePath || "Not found",
    "",
    "Drivers folder:",
    status.driversPath || "Not found",
    "",
    "Startup:",
    status.startupPath || "Not found",
    "",
    "Linker script:",
    status.linkerScriptPath || "Not found",
    "",
    "CMake:",
    status.cmakePath || "Not found",
    "",
    "Ninja:",
    status.ninjaPath || "Not found",
    "",
    "Compiler:",
    status.compilerPath || "Not found",
    "",
    "OpenOCD:",
    status.openocdPath || "Not found",
    "",
    "st-flash:",
    status.stFlashPath || "Not found",
    "",
    "st-info:",
    status.stlinkPath || "Not found"
  ];

  return lines.join("\n");
}

function getProjectDiagnostics(status: Qc1Status): Qc1DiagnosticInfo[] {
  const diagnostics: Qc1DiagnosticInfo[] = [];

  if (!status.projectOk) {
    diagnostics.push({
      code: "QC1-PATH-001",
      level: "error",
      title: "CHEMIN_PROJET_INVALIDE",
      message: "Projet STM32 introuvable",
      cause: "Le chemin ne contient pas un projet STM32 reconnu et l'auto-détection n'a rien trouvé",
      checkedPath: status.projectPath || "--"
    });
    return diagnostics;
  }

  if (!status.cmakeProjectReady) {
    diagnostics.push({
      code: "QC1-PRJ-001",
      level: "error",
      title: "CMAKE_QC1_INTROUVABLE",
      message: "Projet CMake introuvable",
      cause: "Ni CMakeLists.txt natif ni projet CMake QC1 intégré utilisable",
      checkedPath: status.cmakeSourcePath || "--"
    });
  }

  if (!status.sourceOk) {
    diagnostics.push({
      code: "QC1-PRJ-002",
      level: "error",
      title: "SOURCES_INTROUVABLES",
      message: "Dossier de sources introuvable",
      cause: "QC1 accepte Src/ ou Core/Src/",
      checkedPath: status.sourcePath || status.projectPath
    });
  }

  if (status.projectLayout === "cubemx" && !status.driversOk) {
    diagnostics.push({
      code: "QC1-PRJ-003",
      level: "warning",
      title: "DRIVERS_INTROUVABLE",
      message: "Dossier Drivers introuvable",
      cause: "Drivers est attendu pour un projet CubeMX, mais reste optionnel en bare-metal",
      checkedPath: status.driversPath || (status.projectPath ? path.join(status.projectPath, "Drivers") : "--")
    });
  }

  if (!status.startupOk) {
    diagnostics.push({
      code: "QC1-PRJ-004",
      level: "error",
      title: "STARTUP_INTROUVABLE",
      message: "Startup STM32F103 introuvable",
      cause: "Le projet doit contenir startup_stm32f103*.s",
      checkedPath: status.projectPath
    });
  }

  if (!status.linkerScriptOk) {
    diagnostics.push({
      code: "QC1-PRJ-005",
      level: "error",
      title: "LINKER_SCRIPT_INTROUVABLE",
      message: "Linker script introuvable",
      cause: "Le projet doit contenir un fichier .ld",
      checkedPath: status.projectPath
    });
  }

  return diagnostics;
}

function getProjectDiagnostic(status: Qc1Status): Qc1DiagnosticInfo {
  const diagnostics = getProjectDiagnostics(status);
  if (diagnostics.length > 0) return diagnostics[0];
  return {
    code: "QC1-OK-001",
    level: "success",
    title: "PROJET_OK",
    message: "Projet OK",
    cause: `Projet ${status.projectLayout}, sources, startup et linker valides`,
    checkedPath: status.projectPath
  };
}

function getToolDiagnostic(status: Qc1Status, command: string): Qc1DiagnosticInfo | undefined {
  if (!status.cmakeOk && ["build", "clean", "rebuild", "tsmake", "flash", "run", "health", "status"].includes(command)) {
    return {
      code: "QC1-TOOL-001",
      level: "error",
      title: "CMAKE_INTROUVABLE",
      message: "CMake introuvable",
      cause: "La commande nécessite CMake; configure qc1.cmakePath si CMake n'est pas dans le PATH",
      checkedPath: status.cmakePath || "PATH"
    };
  }

  if (!status.ninjaOk && ["build", "clean", "rebuild", "tsmake", "flash", "run"].includes(command)) {
    return {
      code: "QC1-TOOL-004",
      level: "error",
      title: "NINJA_INTROUVABLE",
      message: "Ninja introuvable",
      cause: "La chaîne CMake autonome nécessite Ninja fourni par Embedded Build Tools",
      checkedPath: status.ninjaPath || "PATH"
    };
  }

  if (!status.compilerOk && ["build", "rebuild", "tsmake", "flash", "run"].includes(command)) {
    return {
      code: "QC1-TOOL-002",
      level: "error",
      title: "GCC_ARM_INTROUVABLE",
      message: "arm-none-eabi-gcc introuvable",
      cause: "La commande nécessite le compilateur ARM GCC",
      checkedPath: status.compilerPath || "PATH"
    };
  }

  if (!status.openocdOk && !status.stFlashOk && ["flash", "run"].includes(command)) {
    return {
      code: "QC1-TOOL-003",
      level: "error",
      title: "FLASHER_INTROUVABLE",
      message: "OpenOCD et st-flash introuvables",
      cause: "La commande flash nécessite OpenOCD ou st-flash",
      checkedPath: "PATH"
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

function quoteArg(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function cmakeDefine(name: string, value: string): string {
  return quoteArg(`-D${name}=${value}`);
}

function getExecutionEnv(status: Qc1Status): NodeJS.ProcessEnv {
  const toolDirectories = [
    status.cmakeOk ? path.dirname(status.cmakePath) : "",
    status.ninjaOk ? path.dirname(status.ninjaPath) : "",
    status.compilerOk ? path.dirname(status.compilerPath) : "",
    status.openocdOk ? path.dirname(status.openocdPath) : "",
    status.stFlashOk ? path.dirname(status.stFlashPath) : "",
    status.stlinkToolOk ? path.dirname(status.stlinkPath) : ""
  ].filter(Boolean);
  const currentPath = process.env.PATH || "";

  return {
    ...process.env,
    PATH: [...new Set(toolDirectories), currentPath].filter(Boolean).join(path.delimiter)
  };
}

type DiagnosticProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

function runDiagnosticProcess(
  executable: string,
  args: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv
): Promise<DiagnosticProcessResult> {
  return new Promise((resolve) => {
    execFile(executable, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: 8000,
      maxBuffer: 512 * 1024
    }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? getExitCode(error) ?? 1 : 0,
        stdout: stdout || "",
        stderr: stderr || ""
      });
    });
  });
}

function firstMeaningfulLine(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "--";
}

async function collectDiagnosticToolReports(status: Qc1Status): Promise<DiagnosticToolReport[]> {
  const specifications = [
    { name: "CMake", detected: status.cmakeOk, source: status.cmakeSource, path: status.cmakePath, args: ["--version"] },
    { name: "Ninja", detected: status.ninjaOk, source: status.ninjaSource, path: status.ninjaPath, args: ["--version"] },
    { name: "ARM GCC", detected: status.compilerOk, source: status.compilerSource, path: status.compilerPath, args: ["--version"] },
    { name: "OpenOCD", detected: status.openocdOk, source: status.openocdSource, path: status.openocdPath, args: ["--version"] },
    { name: "st-flash", detected: status.stFlashOk, source: status.stFlashSource, path: status.stFlashPath, args: ["--version"] },
    { name: "st-info", detected: status.stlinkToolOk, source: status.stlinkToolOk ? "setting/PATH" : "introuvable", path: status.stlinkPath, args: ["--version"] }
  ];
  const environment = getExecutionEnv(status);

  return Promise.all(specifications.map(async (tool) => {
    if (!tool.detected) {
      return { ...tool, version: "--" };
    }

    const result = await runDiagnosticProcess(tool.path, tool.args, status.projectPath || undefined, environment);
    return {
      name: tool.name,
      detected: tool.detected,
      source: tool.source,
      path: tool.path,
      version: firstMeaningfulLine(`${result.stdout}\n${result.stderr}`)
    };
  }));
}

function isPathInside(candidate: string, root: string): boolean {
  if (!candidate || !root) return false;
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function collectProjectTree(root: string, maxEntries = 250, maxDepth = 4): string {
  if (!root || !fileExists(root)) return "Projet introuvable.";

  const ignored = new Set([".git", ".vscode", "build", "dist", "node_modules", "out", "__pycache__"]);
  const lines = ["./"];
  let truncated = false;

  function walk(current: string, depth: number): void {
    if (depth > maxDepth || lines.length >= maxEntries) {
      truncated = true;
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
        .filter((entry) => !ignored.has(entry.name) && !entry.name.startsWith("."))
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      return;
    }

    for (const entry of entries) {
      if (lines.length >= maxEntries) {
        truncated = true;
        return;
      }

      const fullPath = path.join(current, entry.name);
      const relative = path.relative(root, fullPath);
      lines.push(`${"  ".repeat(depth)}${relative}${entry.isDirectory() ? "/" : ""}`);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(fullPath, depth + 1);
      }
    }
  }

  walk(root, 1);
  if (truncated) lines.push(`... structure limitée à ${maxEntries} entrées et ${maxDepth} niveaux`);
  return lines.join("\n");
}

function collectVsCodeProblems(projectRoot: string): string[] {
  const severityLabels: Record<number, string> = {
    [vscode.DiagnosticSeverity.Error]: "Erreur",
    [vscode.DiagnosticSeverity.Warning]: "Avertissement",
    [vscode.DiagnosticSeverity.Information]: "Information",
    [vscode.DiagnosticSeverity.Hint]: "Conseil"
  };
  const problems: string[] = [];
  let total = 0;

  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== "file" || (projectRoot && !isPathInside(uri.fsPath, projectRoot))) continue;

    for (const diagnostic of diagnostics) {
      total += 1;
      if (problems.length >= 100) continue;
      const code = typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code;
      const location = `${uri.fsPath}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`;
      const origin = [diagnostic.source, code].filter((value) => value !== undefined && value !== "").join("/");
      const message = diagnostic.message.replace(/\s+/g, " ").trim();
      problems.push(`[${severityLabels[diagnostic.severity]}] ${location}${origin ? ` (${origin})` : ""} — ${message}`);
    }
  }

  if (total > problems.length) problems.push(`... ${total - problems.length} problème(s) supplémentaire(s) omis`);
  return problems;
}

async function collectGitSnapshot(projectRoot: string): Promise<string> {
  if (!projectRoot) return "Projet introuvable; état Git non disponible.";

  const inside = await runDiagnosticProcess("git", ["rev-parse", "--is-inside-work-tree"], projectRoot);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    return "Dépôt Git non détecté pour ce projet.";
  }

  const [head, status] = await Promise.all([
    runDiagnosticProcess("git", ["log", "-1", "--format=commit: %H%nsubject: %s%nauthor-date: %aI"], projectRoot),
    runDiagnosticProcess("git", ["status", "--short", "--branch", "--untracked-files=normal", "--", "."], projectRoot)
  ]);

  return [
    head.stdout.trim() || "Commit indisponible.",
    "",
    status.stdout.trim() || "Arbre de travail propre."
  ].join("\n");
}

function artifactSnapshot(filePath: string): Record<string, unknown> {
  if (!filePath || !fileExists(filePath)) {
    return { path: filePath || "--", exists: false };
  }

  try {
    const stats = fs.statSync(filePath);
    return {
      path: filePath,
      exists: true,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString()
    };
  } catch (error) {
    return { path: filePath, exists: true, inspectionError: (error as Error).message };
  }
}

function openSerialTerminal(context: vscode.ExtensionContext): void {
  const status = getQc1Status(context);
  if (!status.serialPort) {
    vscode.window.showErrorMessage("Aucun port série détecté. Configure qc1.serialPort puis réessaie.");
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: "QC1 Serial",
    env: getExecutionEnv(status)
  });
  if (os.platform() === "win32") {
    terminal.sendText(`mode ${quoteArg(status.serialPort)} BAUD=${status.baudRate} PARITY=n DATA=8 STOP=1 && type ${quoteArg(status.serialPort)}`);
  } else {
    const screenPath = findExecutable("screen");
    if (!screenPath) {
      vscode.window.showErrorMessage("La commande screen est introuvable; installe-la ou utilise un moniteur série VS Code.");
      terminal.dispose();
      return;
    }
    terminal.sendText(`${quoteArg(screenPath)} ${quoteArg(status.serialPort)} ${status.baudRate}`);
  }
  terminal.show();
}

function startOpenOcdTerminal(context: vscode.ExtensionContext): void {
  const status = getQc1Status(context);
  if (!status.openocdOk) {
    vscode.window.showErrorMessage("OpenOCD est introuvable. Configure qc1.openocdPath puis réessaie.");
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: "QC1 OpenOCD",
    env: getExecutionEnv(status)
  });
  terminal.sendText([quoteArg(status.openocdPath), ...getOpenOcdServerArgs().map(quoteArg)].join(" "));
  terminal.show();
}

function buildCmakeExec(status: Qc1Status, command: string): string {
  const config = vscode.workspace.getConfiguration("qc1");
  const buildType = config.get<string>("buildType", "Debug");
  const cmake = quoteArg(status.cmakePath);
  const configureParts = [
    cmake,
    "-S", quoteArg(status.cmakeSourcePath),
    "-B", quoteArg(status.buildPath),
    "-G", quoteArg("Ninja"),
    cmakeDefine("CMAKE_MAKE_PROGRAM", status.ninjaPath),
    cmakeDefine("CMAKE_BUILD_TYPE", buildType)
  ];

  if (!status.nativeCmakeOk) {
    const toolchainPath = path.join(status.cmakeSourcePath, "arm-none-eabi-toolchain.cmake");
    configureParts.push(
      cmakeDefine("CMAKE_TOOLCHAIN_FILE", toolchainPath),
      cmakeDefine("QC1_PROJECT_ROOT", status.projectPath),
      cmakeDefine("QC1_STARTUP", status.startupPath),
      cmakeDefine("QC1_LINKER_SCRIPT", status.linkerScriptPath)
    );

    if (status.compilerOk) {
      configureParts.push(cmakeDefine("QC1_ARM_GCC", status.compilerPath));
    }
  }

  const configure = configureParts.join(" ");
  const build = `${cmake} --build ${quoteArg(status.buildPath)} --config ${quoteArg(buildType)} --parallel`;
  const target = (name: string) => `${cmake} --build ${quoteArg(status.buildPath)} --config ${quoteArg(buildType)} --target ${name}`;
  const objcopyName = os.platform() === "win32" ? "arm-none-eabi-objcopy.exe" : "arm-none-eabi-objcopy";
  const objcopyPath = status.compilerOk ? path.join(path.dirname(status.compilerPath), objcopyName) : "";
  const flash = status.openocdOk
    ? [quoteArg(status.openocdPath), ...getOpenOcdProgramArgs(status.elfPath).map(quoteArg)].join(" ")
    : `${fileExists(objcopyPath) ? `${quoteArg(objcopyPath)} -O binary -S ${quoteArg(status.elfPath)} ${quoteArg(status.binPath)} && ` : ""}${[quoteArg(status.stFlashPath), ...getStFlashWriteArgs(status.binPath).map(quoteArg)].join(" ")}`;

  switch (command) {
    case "clean":
      return `${configure} && ${target("clean")}`;
    case "rebuild":
      return `${configure} && ${target("clean")} && ${build}`;
    case "flash":
      return `${configure} && ${build} && ${flash}`;
    case "run":
      return `${configure} && ${build} && ${flash}`;
    case "status":
    case "health":
    case "error":
    case "dev":
      return quoteArg(status.stlinkPath);
    case "serial":
      return "";
    case "tsmake":
    case "build":
    default:
      return `${configure} && ${build}`;
  }
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
  const buildDir = status.buildPath;
  const elfPath = status.elfPath;
  const binPath = status.binPath;

  dashboardState = {
    ...dashboardState,
    projectName: projectRoot ? path.basename(projectRoot) : "--",
    project: {
      workspaceOpened: status.projectOk,
      projectDetected: status.projectComplete,
      projectStatus: !status.projectOk ? "ERREUR" : status.projectComplete ? "OK" : "PARTIEL",
      cmakeProjectReady: status.cmakeProjectReady,
      coreFolderFound: status.coreOk,
      driversFolderFound: status.driversOk,
      startupFound: status.startupOk,
      linkerScriptFound: status.linkerScriptOk,
      buildFolderFound: Boolean(buildDir) && fileExists(buildDir),
      elfFound: Boolean(elfPath) && fileExists(elfPath),
      binFound: Boolean(binPath) && fileExists(binPath),
      workspacePath: status.projectPath || "--",
      cmakeSourcePath: status.cmakeSourcePath || "--",
      corePath: status.corePath || "--",
      driversPath: status.driversPath || "--",
      startupPath: status.startupPath || "--",
      linkerScriptPath: status.linkerScriptPath || "--"
    },
    environment: {
      ...dashboardState.environment,
      os: getOsLabel(process.platform),
      osRaw: process.platform,
      extensionVersion: context.extension.packageJSON.version || defaultDashboardState.environment.extensionVersion,
      cmakePath: status.cmakePath || "--",
      cmakeSourcePath: status.cmakeSourcePath || "--",
      buildPath: status.buildPath || "--",
      offlinePortable: status.cmakeProjectReady,
      gccDetected: status.compilerOk,
      openocdDetected: status.openocdOk,
      stlinkDetected: status.stlinkProbeOk,
      stFlashInstalled: status.stFlashOk,
      stlinkProbeStatus: status.stlinkProbeStatus,
      cmakeDetected: status.cmakeOk
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
            this.runCommand(msg.command);
          }
          break;

        case "run":
          this.runCommand(msg.command);
          break;

        case "terminal":
          this.runCommand(msg.command);
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

        case "createDiagnosticReport":
          await this.createDiagnosticReport();
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
          const root = getQc1Status(this.context).projectPath || getWorkspaceRoot();
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
    const status = getQc1Status(this.context);

    return {
      os: getOsLabel(process.platform),
      osRaw: process.platform,
      extensionVersion: this.context.extension.packageJSON.version || defaultDashboardState.environment.extensionVersion,
      projectPath: config.get<string>("projectPath", ""),
      cmakePath: config.get<string>("cmakePath", ""),
      buildDirectory: config.get<string>("buildDirectory", "build/qc1"),
      buildType: config.get<string>("buildType", "Debug"),
      compilerPath: config.get<string>("compilerPath", ""),
      openocdPath: config.get<string>("openocdPath", ""),
      serialPort: config.get<string>("serialPort", ""),
      baudRate: config.get<number>("baudRate", 19200),
      stlinkPath: config.get<string>("stlinkPath", "st-info"),
      autoDetectProject: config.get<boolean>("autoDetectProject", true),
      autoClearOutput: config.get<boolean>("autoClearOutput", false),
      showTimestamps: config.get<boolean>("showTimestamps", true),
      outputMaxLines: config.get<number>("outputMaxLines", 500),
      compactMode: config.get<boolean>("compactMode", false),
      cmakeSource: status.cmakeSource,
      cmakeMode: status.nativeCmakeOk ? "projet natif" : "intégré au VSIX",
      detectedCmakePath: status.cmakePath || "--",
      cmakeSourcePath: status.cmakeSourcePath,
      buildPath: status.buildPath,
      offlinePortable: status.cmakeProjectReady
    };
  }

  private async autoDetectPaths() {
    const config = vscode.workspace.getConfiguration("qc1");
    const status = getQc1Status(this.context);
    const updates: Thenable<void>[] = [];

    updates.push(config.update("projectPath", status.projectOk ? status.projectPath : "", vscode.ConfigurationTarget.Workspace));
    updates.push(config.update("cmakePath", status.cmakeOk && status.cmakeSource === "PATH" ? status.cmakePath : "", vscode.ConfigurationTarget.Workspace));
    updates.push(config.update("compilerPath", status.compilerOk && status.compilerSource === "PATH" ? status.compilerPath : "", vscode.ConfigurationTarget.Workspace));
    updates.push(config.update("openocdPath", status.openocdOk && status.openocdSource === "PATH" ? status.openocdPath : "", vscode.ConfigurationTarget.Workspace));
    updates.push(config.update("stlinkPath", status.stlinkToolOk ? status.stlinkPath : "st-info", vscode.ConfigurationTarget.Workspace));
    if (status.serialPort) {
      updates.push(config.update("serialPort", status.serialPort, vscode.ConfigurationTarget.Workspace));
    }

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

  public async createDiagnosticReport(): Promise<void> {
    const issueDescription = await vscode.window.showInputBox({
      title: "Rapport de diagnostic QC1",
      prompt: "Décris brièvement l'erreur et ce que tu faisais lorsqu'elle est apparue.",
      placeHolder: "Exemple : le build échoue après avoir ajouté un nouveau fichier C (facultatif)",
      ignoreFocusOut: true
    });
    if (issueDescription === undefined) return;

    try {
      const report = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "QC1 : collecte du contexte de diagnostic",
        cancellable: false
      }, async (progress) => {
        progress.report({ message: "Projet, outils et problèmes VS Code" });
        const status = getQc1Status(this.context);
        const config = vscode.workspace.getConfiguration("qc1");
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const projectRoot = status.projectPath || getWorkspaceRoot() || "";
        const executionEnvironment = getExecutionEnv(status);
        const probePromise = status.stlinkToolOk
          ? runDiagnosticProcess(status.stlinkPath, ["--probe"], projectRoot || undefined, executionEnvironment)
          : Promise.resolve<DiagnosticProcessResult>({ exitCode: null, stdout: "", stderr: "st-info introuvable" });
        const [tools, gitSnapshot, probe] = await Promise.all([
          collectDiagnosticToolReports(status),
          collectGitSnapshot(projectRoot),
          probePromise
        ]);

        progress.report({ message: "Création et anonymisation du rapport" });
        const relevantExtension = (id: string): Record<string, unknown> => {
          const extension = vscode.extensions.getExtension(id);
          return {
            id,
            installed: Boolean(extension),
            version: extension?.packageJSON?.version || "--",
            active: extension?.isActive || false
          };
        };
        const openDocuments = vscode.workspace.textDocuments
          .filter((document) => document.uri.scheme === "file" && (!projectRoot || isPathInside(document.uri.fsPath, projectRoot)))
          .slice(0, 30)
          .map((document) => ({ path: document.uri.fsPath, dirty: document.isDirty, language: document.languageId }));
        const projectDiagnostics = getProjectDiagnostics(status);
        const reportInput = {
          generatedAt: new Date().toISOString(),
          issueDescription,
          extension: {
            id: `${this.context.extension.packageJSON.publisher}.${this.context.extension.packageJSON.name}`,
            version: this.context.extension.packageJSON.version,
            dependencies: [
              relevantExtension("ms-vscode.cmake-tools"),
              relevantExtension("mylonics.embedded-build-tools")
            ]
          },
          runtime: {
            vscodeVersion: vscode.version,
            vscodeApp: vscode.env.appName,
            vscodeLanguage: vscode.env.language,
            remoteName: vscode.env.remoteName || "local",
            uiKind: vscode.env.uiKind === vscode.UIKind.Desktop ? "desktop" : "web",
            nodeVersion: process.version,
            platform: process.platform,
            architecture: process.arch,
            osRelease: os.release()
          },
          workspace: {
            folders: workspaceFolders.map((folder) => ({ name: folder.name, path: folder.uri.fsPath })),
            trusted: vscode.workspace.isTrusted,
            openDocuments
          },
          project: {
            path: status.projectPath || "--",
            name: status.projectName,
            layout: status.projectLayout,
            complete: status.projectComplete,
            cmakeMode: status.nativeCmakeOk ? "native" : status.bundledCmakeReady ? "QC1 intégré" : "introuvable",
            cmakeSourcePath: status.cmakeSourcePath,
            sourcePath: status.sourcePath,
            corePath: status.corePath,
            driversPath: status.driversPath,
            startupPath: status.startupPath,
            linkerScriptPath: status.linkerScriptPath,
            diagnostics: projectDiagnostics
          },
          configuration: {
            projectPath: config.get<string>("projectPath", ""),
            buildDirectory: config.get<string>("buildDirectory", "build/qc1"),
            buildType: config.get<string>("buildType", "Debug"),
            cmakePath: config.get<string>("cmakePath", ""),
            compilerPath: config.get<string>("compilerPath", ""),
            openocdPath: config.get<string>("openocdPath", ""),
            stlinkPath: config.get<string>("stlinkPath", "st-info"),
            serialPort: config.get<string>("serialPort", ""),
            baudRate: config.get<number>("baudRate", 19200),
            autoDetectProject: config.get<boolean>("autoDetectProject", true),
            autoClearOutput: config.get<boolean>("autoClearOutput", false),
            showTimestamps: config.get<boolean>("showTimestamps", true),
            outputMaxLines: config.get<number>("outputMaxLines", 500)
          },
          dashboard: {
            currentAction: dashboardState.currentAction,
            lastCommand: dashboardState.lastCommand,
            diagnostic: dashboardState.diagnostic,
            progress: dashboardState.progress,
            build: dashboardState.build,
            flash: dashboardState.flash
          },
          artifacts: {
            buildDirectory: artifactSnapshot(status.buildPath),
            elf: artifactSnapshot(status.elfPath),
            bin: artifactSnapshot(status.binPath)
          },
          hardware: {
            serialPort: status.serialPort || "non configuré/détecté",
            baudRate: status.baudRate,
            previousStlinkState: status.stlinkProbeStatus,
            currentProbeExitCode: probe.exitCode,
            currentProbeOutput: `${probe.stdout}\n${probe.stderr}`.trim() || "--"
          },
          tools,
          vscodeProblems: collectVsCodeProblems(projectRoot),
          gitSnapshot,
          projectTree: collectProjectTree(projectRoot),
          logs: this.outputLines.slice(-1000).join("\n") || "Aucun journal QC1 disponible."
        };
        const redactions = [
          { value: status.projectPath, replacement: "<PROJECT>" },
          ...workspaceFolders.map((folder) => ({ value: folder.uri.fsPath, replacement: "<WORKSPACE>" })),
          { value: this.context.extensionPath, replacement: "<EXTENSION>" },
          { value: os.homedir(), replacement: "<HOME>" }
        ];

        return buildDiagnosticReport(reportInput, redactions);
      });

      const preview = await vscode.workspace.openTextDocument({ content: report, language: "markdown" });
      await vscode.window.showTextDocument(preview, { preview: true });
      const action = await vscode.window.showInformationMessage(
        "Rapport QC1 généré et prévisualisé. Vérifie-le avant de l'envoyer.",
        "Enregistrer le rapport",
        "Copier le rapport"
      );

      if (action === "Copier le rapport") {
        await vscode.env.clipboard.writeText(report);
        this.postStatus("Rapport copié", "success");
        return;
      }

      if (action === "Enregistrer le rapport") {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const defaultRoot = getQc1Status(this.context).projectPath || getWorkspaceRoot() || this.context.extensionPath;
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(defaultRoot, `qc1-diagnostic-${timestamp}.md`)),
          filters: { Markdown: ["md"], Text: ["txt"] },
          saveLabel: "Enregistrer le rapport QC1"
        });
        if (uri) {
          await vscode.workspace.fs.writeFile(uri, Buffer.from(report, "utf8"));
          const savedDocument = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(savedDocument, { preview: false });
          this.postStatus("Rapport enregistré", "success");
        }
      }
    } catch (error) {
      const message = `Impossible de générer le rapport QC1 : ${(error as Error).message}`;
      outputChannel?.appendLine(`[QC1] ${message}`);
      vscode.window.showErrorMessage(message);
      this.postStatus("Échec du rapport", "error");
    }
  }

  public runCommand(command: string): void {
    if (command === "detect-stlink") {
      this.detectStlink();
      return;
    }
    if (command === "open-serial") {
      this.openSerial();
      return;
    }
    if (command === "start-openocd") {
      this.startOpenOcd();
      return;
    }
    if (["status", "health", "error", "dev"].includes(command)) {
      this.runStatus(command);
      return;
    }
    if (command === "serial") {
      openSerialTerminal(this.context);
      return;
    }
    this.runQC1(command);
  }

  public detectStlink(): void {
    this.runStatus("detect-stlink");
  }

  public openSerial(): void {
    openSerialTerminal(this.context);
  }

  public startOpenOcd(): void {
    startOpenOcdTerminal(this.context);
  }

  private runStatus(command: string): void {
    const status = getQc1Status(this.context);
    const config = this.getConfig();
    const cwd = status.projectPath || getWorkspaceRoot() || "--";
    if (config.autoClearOutput) this.clearOutput();

    this.appendOutput(`$ qc1 ${command}`, "command");
    this.appendOutput(`CWD: ${cwd}`, "command");
    dashboardState = {
      ...dashboardState,
      lastCommand: command,
      currentAction: command === "detect-stlink" ? "Détection ST-Link" : "Diagnostic"
    };

    const finish = (probeOutput: string, probeError?: unknown): void => {
      if (status.stlinkToolOk) {
        const detected = readStlinkProbeStatus(probeOutput);
        stlinkProbeStatus = detected === "non testé" && probeError ? "non détecté" : detected;
      }

      syncDashboardState(this.context);
      this.appendOutput(formatDiagnostic(getQc1Status(this.context)), "stdout");
      if (status.stlinkToolOk) {
        this.appendOutput([
          "",
          "Probe ST-Link",
          `Commande: ${quoteArg(status.stlinkPath)} --probe`,
          `Exit    : ${probeError ? getExitCode(probeError) ?? 1 : 0}`,
          probeOutput.trim() || "--"
        ].join("\n"), probeError ? "error" : "stdout");
      } else {
        this.appendOutput("Probe ST-Link non exécuté: st-info introuvable", "error");
      }
      refreshDashboard();
      this.sendToolsStatus();
      this.sendTerminalMeta();
      this.postStatus(command === "detect-stlink" ? `ST-Link: ${stlinkProbeStatus}` : "Status terminé", probeError ? "error" : "success");
      this.appendOutput("--- terminé ---", "separator");
    };

    if (!status.stlinkToolOk) {
      finish("");
      return;
    }

    execFile(status.stlinkPath, ["--probe"], {
      cwd: status.projectPath || getWorkspaceRoot(),
      env: getExecutionEnv(status),
      encoding: "utf8",
      timeout: 15000
    }, (error, stdout, stderr) => finish(`${stdout || ""}\n${stderr || ""}`, error || undefined));
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

    const projectDir = toolStatus.projectPath || root;
    const displayedCommand = `qc1 ${command}`;

    this.postStatus(`Running: ${command}`, "running");
    this.appendOutput(`$ ${displayedCommand}`, "command");
    this.appendOutput(`CWD: ${projectDir}`, "command");
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
        command: displayedCommand,
        cwd: projectDir,
        path: toolStatus.cmakeSourcePath
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

    const projectDiagnostic = getProjectDiagnostics(toolStatus).find((diagnostic) => diagnostic.level === "error");
    const toolDiagnostic = getToolDiagnostic(toolStatus, command);
    const blockingDiagnostic = projectDiagnostic || toolDiagnostic;

    if (blockingDiagnostic) {
      const qc1Error = createQc1ErrorFromDiagnostic(blockingDiagnostic, displayedCommand, projectDir);
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

    const fullCommand = buildCmakeExec(toolStatus, command);

    setTimeout(() => {
      dashboardState = updateProgress(dashboardState, 35, "Execution du script QC1");
      refreshDashboard();
    }, 500);

    setTimeout(() => {
      dashboardState = updateProgress(dashboardState, 70, "Traitement de la sortie");
      refreshDashboard();
    }, 1500);

    exec(fullCommand, {
      cwd: projectDir,
      env: getExecutionEnv(toolStatus),
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

      if (["build", "rebuild", "tsmake", "run"].includes(command)) {
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

      if (["flash", "run"].includes(command)) {
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
        const qc1Error = createQc1ErrorFromProcess(error, fullCommand, projectDir, stdoutText, stderrText);
        commandError = qc1Error;
        dashboardState = finishProgress(
          dashboardState,
          success,
          "QC1-CMD-OK",
          qc1Error.code,
          ["build", "rebuild", "tsmake", "run"].includes(command) ? "BUILD_SUCCESS" : command === "flash" ? "FLASH_SUCCESS" : "COMMAND_DONE",
          qc1Error.title,
          success ? `${command} terminé` : qc1Error.message,
          qc1Error.cause || "La commande QC1 a retourné une erreur",
          projectDir
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
              cwd: projectDir,
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
          ["build", "rebuild", "tsmake", "run"].includes(command) ? "BUILD_SUCCESS" : command === "flash" ? "FLASH_SUCCESS" : "COMMAND_DONE",
          qc1Error?.title || "COMMANDE_ECHOUEE",
          success ? `${command} terminé` : qc1Error?.message || "Commande échouée",
          success ? "Commande terminée sans erreur détectée" : failureCause,
          projectDir
        );
        refreshDashboard();
        stopRuntimeTimer();
        if (success) {
          this.appendQc1CommandResult(fullCommand, projectDir, 0, stdoutText, stderrText);
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
    void vscode.window.showErrorMessage(
      `[${qc1Error.code}] ${qc1Error.message}`,
      "Créer un rapport"
    ).then((action) => {
      if (action === "Créer un rapport") {
        void this.createDiagnosticReport();
      }
    });
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

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("QC1 STM32 Tools");
  context.subscriptions.push(outputChannel);
  await initializeEmbeddedBuildTools();
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
    provider.runCommand("build");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.clean", () => {
    provider.runCommand("clean");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.rebuild", () => {
    provider.runCommand("rebuild");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.tsmake", () => {
    provider.runCommand("tsmake");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.flash", () => {
    provider.runCommand("flash");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.run", () => {
    provider.runCommand("run");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.health", () => {
    provider.runCommand("health");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.status", () => {
    provider.runCommand("status");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.error", () => {
    provider.runCommand("error");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.detectStlink", () => {
    provider.detectStlink();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.openSerial", () => {
    provider.openSerial();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.startOpenOcd", () => {
    provider.startOpenOcd();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.configure", () => {
    vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Mistral400.QC1-STM32-Tools qc1");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.createDiagnosticReport", () => {
    return provider.createDiagnosticReport();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.refresh", () => {
    provider.clearOutput();
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.dev", () => {
    provider.runCommand("dev");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("qc1.openSettings", () => {
    vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Mistral400.QC1-STM32-Tools");
  }));
}

export function deactivate() {}
