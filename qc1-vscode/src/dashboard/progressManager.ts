/**
 * RÉSUMÉ DU FICHIER — PROGRESSION RÉELLE CMAKE/NINJA
 *
 * `ProgressManager` reçoit les morceaux de stdout produits pendant le build.
 * Quand Ninja écrit une ligne comme `[14/37] Building C object...`, il calcule
 * 14 / 37 = 38 %, conserve l'étape lisible et avertit `extension.ts`.
 *
 * Le manager mesure donc le nombre réel de tâches Ninja terminées. Il maintient
 * aussi le temps écoulé, même lorsqu'aucune nouvelle ligne n'arrive.
 */

export type Qc1ProgressPhase =
  | "idle"
  | "preparing"
  | "configuring"
  | "cleaning"
  | "building"
  | "flashing"
  | "complete"
  | "error";

export interface Qc1ProgressUpdate {
  active: boolean;
  taskName: string;
  phase: Qc1ProgressPhase;
  currentStep: string;
  completedSteps: number;
  totalSteps: number;
  progressPercent: number;
  measured: boolean;
  runtimeSeconds: number;
}

type ProgressListener = (progress: Qc1ProgressUpdate) => void;

// Supprime les couleurs/contrôles ANSI avant d'analyser les lignes du terminal.
function stripAnsi(value: string): string {
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}

export class ProgressManager {
  private active = false;
  private taskName = "";
  private phase: Qc1ProgressPhase = "idle";
  private currentStep = "En attente";
  private completedSteps = 0;
  private totalSteps = 0;
  private progressPercent = 0;
  private measured = false;
  private startedAt = 0;
  private streamBuffer = "";
  private lastNinjaProgress = "";
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly listener: ProgressListener) {}

  /** Démarre une nouvelle opération et le compteur de durée. */
  start(taskName: string, currentStep = "Préparation"): void {
    this.stopTimer();
    this.active = true;
    this.taskName = taskName;
    this.phase = "preparing";
    this.currentStep = currentStep;
    this.completedSteps = 0;
    this.totalSteps = 0;
    this.progressPercent = 0;
    this.measured = false;
    this.startedAt = Date.now();
    this.streamBuffer = "";
    this.lastNinjaProgress = "";
    this.emit();
    this.timer = setInterval(() => this.emit(), 1000);
  }

  /** Change la phase lorsque CMake configure, nettoie, compile ou flashe. */
  setPhase(phase: Qc1ProgressPhase, currentStep: string): void {
    this.phase = phase;
    this.currentStep = currentStep;
    this.emit();
  }

  /**
   * Accepte un morceau de stdout, même si une ligne `[x/y]` est coupée entre
   * deux événements `data`. Les retours chariot de Ninja sont traités comme des lignes.
   */
  consumeOutput(chunk: string): void {
    this.streamBuffer += stripAnsi(chunk);
    const lines = this.streamBuffer.split(/\r\n|\n|\r/);
    this.streamBuffer = lines.pop() || "";

    for (const line of lines) this.consumeLine(line);
    // Ninja peut laisser la ligne courante sans saut de ligne pendant un moment.
    this.consumeLine(this.streamBuffer);
  }

  /** Termine l'opération et arrête le compteur de durée. */
  finish(success: boolean, message: string): void {
    this.stopTimer();
    this.active = false;
    this.phase = success ? "complete" : "error";
    this.currentStep = message;
    if (success) {
      this.progressPercent = 100;
      if (this.measured) this.completedSteps = this.totalSteps;
    }
    this.emit();
  }

  dispose(): void {
    this.stopTimer();
  }

  private consumeLine(line: string): void {
    const match = line.match(/\[\s*(\d+)\s*\/\s*(\d+)\s*\]\s*(.*)$/);
    if (!match) return;

    const completed = Number.parseInt(match[1], 10);
    const total = Number.parseInt(match[2], 10);
    if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return;

    const signature = `${completed}/${total}:${match[3]}`;
    if (signature === this.lastNinjaProgress) return;
    this.lastNinjaProgress = signature;
    this.phase = "building";
    this.completedSteps = Math.max(0, Math.min(completed, total));
    this.totalSteps = total;
    this.progressPercent = Math.round((this.completedSteps / total) * 100);
    this.measured = true;
    this.currentStep = match[3].trim() || `Tâche Ninja ${completed}/${total}`;
    this.emit();
  }

  private emit(): void {
    this.listener({
      active: this.active,
      taskName: this.taskName,
      phase: this.phase,
      currentStep: this.currentStep,
      completedSteps: this.completedSteps,
      totalSteps: this.totalSteps,
      progressPercent: this.progressPercent,
      measured: this.measured,
      runtimeSeconds: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0
    });
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
