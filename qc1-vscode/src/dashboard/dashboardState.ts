export type QC1StatusLevel =
  | "success"
  | "info"
  | "warning"
  | "error"
  | "idle";

export interface QC1Diagnostic {
  code: string;
  level: QC1StatusLevel;
  title: string;
  message: string;
  cause: string;
  checkedPath: string;
}

export interface QC1TaskProgress {
  active: boolean;
  taskName: string;
  runtimeSeconds: number;
  progressPercent: number;
  currentStep: string;
  startedAt?: number;
}

export interface QC1BuildStatus {
  lastBuildTime: string;
  lastBuildSuccess: boolean;

  buildRuntimeMs: number;

  errors: number;
  warnings: number;

  flashUsage?: string;
  ramUsage?: string;

  elfGenerated: boolean;
  binGenerated: boolean;
}

export interface QC1FlashStatus {
  lastFlashTime: string;
  lastFlashSuccess: boolean;

  flashRuntimeMs: number;

  method: string;
  targetMCU: string;
}

export interface QC1ProjectStatus {
  workspaceOpened: boolean;

  projectDetected: boolean;
  projectStatus: "OK" | "PARTIEL" | "ERREUR";

  cmakeProjectReady: boolean;

  coreFolderFound: boolean;
  driversFolderFound: boolean;
  startupFound: boolean;
  linkerScriptFound: boolean;
  buildFolderFound: boolean;

  elfFound: boolean;
  binFound: boolean;

  workspacePath: string;
  cmakeSourcePath: string;
  corePath: string;
  driversPath: string;
  startupPath: string;
  linkerScriptPath: string;
}

export interface QC1EnvironmentStatus {
  os: string;
  osRaw: NodeJS.Platform;

  extensionVersion: string;
  cmakePath: string;
  cmakeSourcePath: string;
  buildPath: string;
  offlinePortable: boolean;

  gccDetected: boolean;
  openocdDetected: boolean;
  stlinkDetected: boolean;
  stFlashInstalled: boolean;
  stlinkProbeStatus: "OK" | "non détecté" | "non testé";
  cmakeDetected: boolean;
}

export interface DashboardState {
  currentAction: string;
  projectName: string;
  lastCommand: string;

  diagnostic: QC1Diagnostic;

  progress: QC1TaskProgress;

  build: QC1BuildStatus;

  flash: QC1FlashStatus;

  project: QC1ProjectStatus;

  environment: QC1EnvironmentStatus;
}

export function getOsLabel(platform: NodeJS.Platform): string {
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

export const defaultDashboardState: DashboardState = {
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
export function startProgress(
  state: DashboardState,
  taskName: string,
  currentStep: string
): DashboardState {
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

export function updateProgress(
  state: DashboardState,
  progressPercent: number,
  currentStep: string
): DashboardState {
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

export function finishProgress(
  state: DashboardState,
  success: boolean,
  successCode: string,
  errorCode: string,
  successTitle: string,
  errorTitle: string,
  message: string,
  cause = success ? "Commande terminée" : "Commande échouée",
  checkedPath = "--"
): DashboardState {
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
