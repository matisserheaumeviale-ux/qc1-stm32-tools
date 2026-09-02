"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultDashboardState = void 0;
exports.getOsLabel = getOsLabel;
exports.startProgress = startProgress;
exports.updateProgress = updateProgress;
exports.finishProgress = finishProgress;
function getOsLabel(platform) {
    switch (platform) {
        case "darwin":
            return "macOS";
        case "win32":
            return "Windows";
        case "linux":
            return "Linux";
        default:
            return platform;
    }
}
exports.defaultDashboardState = {
    currentAction: "Idle",
    projectName: "--",
    lastCommand: "--",
    diagnostic: {
        code: "QC1-IDLE-001",
        level: "idle",
        title: "IDLE",
        message: "Aucune tâche active",
        cause: "--",
        checkedPath: "--"
    },
    progress: {
        active: false,
        taskName: "",
        runtimeSeconds: 0,
        progressPercent: 0,
        currentStep: ""
    },
    build: {
        lastBuildTime: "Jamais",
        lastBuildSuccess: false,
        buildRuntimeMs: 0,
        errors: 0,
        warnings: 0,
        flashUsage: "--",
        ramUsage: "--",
        elfGenerated: false,
        binGenerated: false
    },
    flash: {
        lastFlashTime: "Jamais",
        lastFlashSuccess: false,
        flashRuntimeMs: 0,
        method: "--",
        targetMCU: "--"
    },
    project: {
        workspaceOpened: false,
        projectDetected: false,
        projectStatus: "ERREUR",
        cmakeProjectReady: false,
        coreFolderFound: false,
        driversFolderFound: false,
        startupFound: false,
        linkerScriptFound: false,
        buildFolderFound: false,
        elfFound: false,
        binFound: false,
        workspacePath: "--",
        cmakeSourcePath: "--",
        corePath: "--",
        driversPath: "--",
        startupPath: "--",
        linkerScriptPath: "--"
    },
    environment: {
        os: getOsLabel(process.platform),
        osRaw: process.platform,
        extensionVersion: "0.3.1",
        cmakePath: "--",
        cmakeSourcePath: "--",
        buildPath: "--",
        offlinePortable: true,
        gccDetected: false,
        openocdDetected: false,
        stlinkDetected: false,
        stFlashInstalled: false,
        stlinkProbeStatus: "non testé",
        cmakeDetected: false
    }
};
function startProgress(state, taskName, currentStep) {
    return {
        ...state,
        currentAction: `${taskName} en cours`,
        progress: {
            active: true,
            taskName,
            runtimeSeconds: 0,
            progressPercent: 5,
            currentStep,
            startedAt: Date.now()
        },
        diagnostic: {
            code: "QC1-CMD-START",
            level: "info",
            title: `${taskName.toUpperCase()}_STARTED`,
            message: `${taskName} démarré`,
            cause: "Commande QC1 en cours",
            checkedPath: "--"
        }
    };
}
function updateProgress(state, progressPercent, currentStep) {
    const startedAt = state.progress.startedAt ?? Date.now();
    const runtimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
    return {
        ...state,
        progress: {
            ...state.progress,
            active: true,
            runtimeSeconds,
            progressPercent: Math.max(0, Math.min(100, progressPercent)),
            currentStep
        }
    };
}
function finishProgress(state, success, successCode, errorCode, successTitle, errorTitle, message, cause = success ? "Commande terminée" : "Commande échouée", checkedPath = "--") {
    const startedAt = state.progress.startedAt ?? Date.now();
    const runtimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
    return {
        ...state,
        currentAction: success ? "Terminé" : "Erreur",
        progress: {
            ...state.progress,
            active: false,
            runtimeSeconds,
            progressPercent: success ? 100 : state.progress.progressPercent,
            currentStep: message
        },
        diagnostic: {
            code: success ? successCode : errorCode,
            level: success ? "success" : "error",
            title: success ? successTitle : errorTitle,
            message,
            cause,
            checkedPath
        }
    };
}
//# sourceMappingURL=dashboardState.js.map