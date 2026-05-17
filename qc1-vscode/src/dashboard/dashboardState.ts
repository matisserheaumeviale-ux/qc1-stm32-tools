export type QC1StatusLevel =
  | "success"
  | "info"
  | "warning"
  | "error"
  | "idle";

export interface QC1Diagnostic {
  code: number;
  level: QC1StatusLevel;
  title: string;
  message: string;
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

  makefileFound: boolean;

  coreFolderFound: boolean;
  driversFolderFound: boolean;
  buildFolderFound: boolean;

  elfFound: boolean;
  binFound: boolean;
}

export interface QC1EnvironmentStatus {
  os: string;

  extensionVersion: string;
  quickCommandPath: string;
  makePath: string;
  bundledMakePath: string;
  offlinePortable: boolean;

  gccDetected: boolean;
  openocdDetected: boolean;
  stlinkDetected: boolean;
  makeDetected: boolean;

  bundledMakeUsed: boolean;
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

export const defaultDashboardState: DashboardState = {
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

    extensionVersion: "0.1.2",
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
      code: 301,
      level: "info",
      title: `${taskName.toUpperCase()}_STARTED`,
      message: `${taskName} démarré`
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
  successCode: number,
  errorCode: number,
  successTitle: string,
  errorTitle: string,
  message: string
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
      message
    }
  };
}
