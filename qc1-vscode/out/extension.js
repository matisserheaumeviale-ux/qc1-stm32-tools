"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const child_process_1 = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const dashboardState_1 = require("./dashboard/dashboardState");
const dashboardHtml_1 = require("./dashboard/dashboardHtml");
const qc1Parser_1 = require("./qc1/qc1Parser");
let dashboardState = dashboardState_1.defaultDashboardState;
let dashboardPanel;
let progressTimer;
let outputChannel;
function fileExists(filePath) {
    try {
        return fs.existsSync(filePath);
    }
    catch {
        return false;
    }
}
function getWorkspaceRoot() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
function findMakefile(dir) {
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
            }
            catch { }
        }
    }
    return null;
}
function getPathCandidates(name) {
    const pathValue = process.env.PATH || "";
    const directories = pathValue.split(path.delimiter).filter(Boolean);
    const extensions = os.platform() === "win32"
        ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
            .split(";")
            .filter(Boolean)
        : [""];
    const candidates = [];
    for (const dir of directories) {
        if (os.platform() === "win32") {
            const lowerName = name.toLowerCase();
            const hasKnownExt = extensions.some((ext) => lowerName.endsWith(ext.toLowerCase()));
            if (hasKnownExt) {
                candidates.push(path.join(dir, name));
            }
            else {
                for (const ext of extensions) {
                    candidates.push(path.join(dir, `${name}${ext}`));
                }
            }
        }
        else {
            candidates.push(path.join(dir, name));
        }
    }
    return candidates;
}
function findExecutable(name) {
    for (const candidate of getPathCandidates(name)) {
        if (fileExists(candidate)) {
            return candidate;
        }
    }
    return null;
}
function getQc1Status(context) {
    const config = vscode.workspace.getConfiguration("qc1");
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
    const projectPath = (config.get("projectPath") || "").trim() || workspaceRoot;
    const makefilePathSetting = (config.get("makefilePath") || "").trim();
    const compilerPathSetting = (config.get("compilerPath") || "").trim();
    const openocdPathSetting = (config.get("openocdPath") || "").trim();
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
function formatDiagnostic(status) {
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
function getQuickCommandPath(context) {
    const config = vscode.workspace.getConfiguration("qc1");
    const customPath = config.get("quickCommandPath", "").trim();
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
        }
        else {
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
    }
    else {
        const bundledScript = path.join(context.extensionPath, "resources", "scripts", "quick-command");
        if (fileExists(bundledScript)) {
            return bundledScript;
        }
    }
    return "quick-command";
}
function quoteArg(arg) {
    return `"${arg.replace(/"/g, '\\"')}"`;
}
function buildQuickCommandExec(commandPath, args) {
    const quotedArgs = args.map(quoteArg).join(" ");
    if (os.platform() === "win32") {
        if (commandPath.toLowerCase().endsWith(".ps1")) {
            return `powershell -ExecutionPolicy Bypass -File "${commandPath}" ${quotedArgs}`.trim();
        }
        return `cmd /c ""${commandPath}" ${quotedArgs}"`.trim();
    }
    return `chmod +x "${commandPath}" && "${commandPath}" ${quotedArgs}`.trim();
}
function runQuickCommand(context, args) {
    const terminal = vscode.window.createTerminal("QC1 STM32");
    const quickCommand = getQuickCommandPath(context);
    terminal.sendText(buildQuickCommandExec(quickCommand, args));
    terminal.show();
}
function refreshDashboard() {
    if (dashboardPanel) {
        dashboardPanel.webview.html = (0, dashboardHtml_1.getDashboardHtml)(dashboardState);
    }
}
function startRuntimeTimer() {
    stopRuntimeTimer();
    progressTimer = setInterval(() => {
        if (!dashboardState.progress.active) {
            stopRuntimeTimer();
            return;
        }
        dashboardState = (0, dashboardState_1.updateProgress)(dashboardState, dashboardState.progress.progressPercent, dashboardState.progress.currentStep);
        refreshDashboard();
    }, 1000);
}
function stopRuntimeTimer() {
    if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = undefined;
    }
}
function syncDashboardState(context) {
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
            extensionVersion: context.extension.packageJSON.version || dashboardState_1.defaultDashboardState.environment.extensionVersion,
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
class QC1PanelProvider {
    constructor(extensionUri, context) {
        this.extensionUri = extensionUri;
        this.context = context;
        this.outputLines = [];
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        dashboardPanel = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = (0, dashboardHtml_1.getDashboardHtml)(dashboardState);
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case "command":
                    if (msg.command === "openLogs") {
                        outputChannel?.show(true);
                    }
                    else {
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
                    vscode.commands.executeCommand("workbench.action.openSettings", "@ext:Mistral400.QC1-STM32-Tools");
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
    getConfig() {
        const config = vscode.workspace.getConfiguration("qc1");
        return {
            quickCommandPath: getQuickCommandPath(this.context),
            os: process.platform,
            extensionVersion: this.context.extension.packageJSON.version || dashboardState_1.defaultDashboardState.environment.extensionVersion,
            projectPath: config.get("projectPath", ""),
            makefilePath: config.get("makefilePath", ""),
            compilerPath: config.get("compilerPath", ""),
            openocdPath: config.get("openocdPath", ""),
            autoClearOutput: config.get("autoClearOutput", false),
            showTimestamps: config.get("showTimestamps", true),
            outputMaxLines: config.get("outputMaxLines", 500),
            compactMode: config.get("compactMode", false),
            makeSource: getQc1Status(this.context).makeSource === "integre" ? "bundled" : "systeme",
            makePath: getQc1Status(this.context).makePath || "--",
            bundledMakePath: path.join(this.context.extensionPath, "resources", "tools", "windows", "make.exe"),
            offlinePortable: getQuickCommandPath(this.context).startsWith(this.context.extensionPath)
        };
    }
    async autoDetectPaths() {
        const config = vscode.workspace.getConfiguration("qc1");
        const status = getQc1Status(this.context);
        const updates = [];
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
    async saveLog() {
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
    runQC1(command) {
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
        dashboardState = (0, dashboardState_1.startProgress)(dashboardState, command, "Preparation de la commande");
        refreshDashboard();
        startRuntimeTimer();
        dashboardState = (0, dashboardState_1.updateProgress)(dashboardState, 15, "Validation du projet");
        refreshDashboard();
        setTimeout(() => {
            dashboardState = (0, dashboardState_1.updateProgress)(dashboardState, 35, "Execution du script QC1");
            refreshDashboard();
        }, 500);
        setTimeout(() => {
            dashboardState = (0, dashboardState_1.updateProgress)(dashboardState, 70, "Traitement de la sortie");
            refreshDashboard();
        }, 1500);
        (0, child_process_1.exec)(fullCommand, {
            cwd: makeDir,
            env: buildQc1Env(this.context),
            encoding: "utf8"
        }, (error, stdout, stderr) => {
            if (stdout)
                this.appendOutput(stdout, "stdout");
            if (stderr)
                this.appendOutput(stderr, "stderr");
            const fullOutput = `${stdout ?? ""}\n${stderr ?? ""}`;
            const parsed = (0, qc1Parser_1.parseQc1Output)(fullOutput);
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
            const success = !error &&
                parsed.errors === 0 &&
                !parsed.hasBuildFailed &&
                !parsed.hasFlashFailed;
            if (error) {
                dashboardState = (0, dashboardState_1.finishProgress)(dashboardState, success, command === "make" ? 202 : command === "flash" ? 203 : 201, command === "make" ? 500 : command === "flash" ? 501 : 504, command === "make" ? "BUILD_SUCCESS" : command === "flash" ? "FLASH_SUCCESS" : "COMMAND_DONE", command === "make" ? "BUILD_FAILED" : command === "flash" ? "FLASH_FAILED" : "EXECUTION_FAILED", success ? `${command} termine` : `${command} echoue`);
                refreshDashboard();
                stopRuntimeTimer();
                this.appendOutput(`Erreur: ${error.message}`, "error");
                this.postStatus(`Failed: ${command}`, "error");
            }
            else {
                dashboardState = (0, dashboardState_1.finishProgress)(dashboardState, success, command === "make" ? 202 : command === "flash" ? 203 : 201, command === "make" ? 500 : command === "flash" ? 501 : 504, command === "make" ? "BUILD_SUCCESS" : command === "flash" ? "FLASH_SUCCESS" : "COMMAND_DONE", command === "make" ? "BUILD_FAILED" : command === "flash" ? "FLASH_FAILED" : "EXECUTION_FAILED", success ? `${command} termine` : `${command} echoue`);
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
    clearOutput() {
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
    sendToolsStatus() {
        this.view?.webview.postMessage({
            type: "toolsStatus",
            tools: getQc1Status(this.context)
        });
    }
    sendTerminalMeta() {
        this.view?.webview.postMessage({
            type: "terminalMeta",
            meta: {
                projectName: dashboardState.projectName,
                lastCommand: dashboardState.lastCommand
            }
        });
    }
    sendAnalysis(parsed) {
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
QC1PanelProvider.viewType = "qc1.panel";
function getWindowsToolsDir(context) {
    return path.join(context.extensionPath, "resources", "tools", "windows");
}
function buildQc1Env(context) {
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
function activate(context) {
    outputChannel = vscode.window.createOutputChannel("QC1 STM32 Tools");
    context.subscriptions.push(outputChannel);
    syncDashboardState(context);
    const provider = new QC1PanelProvider(context.extensionUri, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(QC1PanelProvider.viewType, provider));
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
function deactivate() { }
//# sourceMappingURL=extension.js.map