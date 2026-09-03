"use strict";
/**
 * RÉSUMÉ DU FICHIER — ÉTAT DU TABLEAU DE BORD QC1
 *
 * Ce fichier décrit toutes les données affichées par l'interface QC1 : diagnostic,
 * progression, build, flash, projet et outils. Il ne crée aucun élément visuel.
 * `extension.ts` modifie cet état, puis `dashboardHtml.ts` le transforme en HTML.
 *
 * Flux principal :
 *   commande VS Code -> extension.ts -> DashboardState -> dashboardHtml.ts -> Webview
 *
 * Barre de progression : `ProgressManager` lit maintenant les compteurs `[x/y]`
 * de Ninja. Cet état conserve x, y, le pourcentage réel, la phase et la durée.
 *
 * À modifier ici : forme de l'état, valeurs initiales et règles de progression.
 * À modifier dans dashboardHtml.ts : apparence visuelle de ces données.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultDashboardState = void 0;
exports.getOsLabel = getOsLabel;
exports.finishProgress = finishProgress;
/** Convertit le nom technique de Node.js en libellé lisible dans l'interface. */
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
// Premier état affiché avant la détection du projet ou le lancement d'une commande.
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
        phase: "idle",
        runtimeSeconds: 0,
        progressPercent: 0,
        completedSteps: 0,
        totalSteps: 0,
        measured: false,
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
/**
 * Ferme la progression et remplace aussi le diagnostic principal.
 * En cas d'erreur, la barre reste au dernier jalon atteint pour montrer où ça a bloqué.
 */
function finishProgress(state, success, successCode, errorCode, successTitle, errorTitle, message, cause = success ? "Commande terminée" : "Commande échouée", checkedPath = "--") {
    const runtimeSeconds = state.progress.startedAt
        ? Math.floor((Date.now() - state.progress.startedAt) / 1000)
        : state.progress.runtimeSeconds;
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