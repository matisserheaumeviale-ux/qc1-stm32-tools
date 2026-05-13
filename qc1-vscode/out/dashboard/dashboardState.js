"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultDashboardState = void 0;
exports.startProgress = startProgress;
exports.updateProgress = updateProgress;
exports.finishProgress = finishProgress;
exports.defaultDashboardState = {
    currentAction: "Idle",
    projectName: "--",
    lastCommand: "--",
    diagnostic: {
        code: 300,
        level: "idle",
        title: "IDLE",
        message: "Aucune tâche active"
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
        makefileFound: false,
        coreFolderFound: false,
        driversFolderFound: false,
        buildFolderFound: false,
        elfFound: false,
        binFound: false
    },
    environment: {
        os: process.platform,
        extensionVersion: "0.1.1",
        quickCommandPath: "quick-command",
        makePath: "--",
        bundledMakePath: "--",
        offlinePortable: false,
        gccDetected: false,
        openocdDetected: false,
        stlinkDetected: false,
        makeDetected: false,
        bundledMakeUsed: false
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
            code: 301,
            level: "info",
            title: `${taskName.toUpperCase()}_STARTED`,
            message: `${taskName} démarré`
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
function finishProgress(state, success, successCode, errorCode, successTitle, errorTitle, message) {
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
            message
        }
    };
}
//# sourceMappingURL=dashboardState.js.map