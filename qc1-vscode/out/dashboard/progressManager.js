"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProgressManager = void 0;
// Supprime les couleurs/contrôles ANSI avant d'analyser les lignes du terminal.
function stripAnsi(value) {
    return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}
class ProgressManager {
    constructor(listener) {
        this.listener = listener;
        this.active = false;
        this.taskName = "";
        this.phase = "idle";
        this.currentStep = "En attente";
        this.completedSteps = 0;
        this.totalSteps = 0;
        this.progressPercent = 0;
        this.measured = false;
        this.startedAt = 0;
        this.streamBuffer = "";
        this.lastNinjaProgress = "";
    }
    /** Démarre une nouvelle opération et le compteur de durée. */
    start(taskName, currentStep = "Préparation") {
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
    setPhase(phase, currentStep) {
        this.phase = phase;
        this.currentStep = currentStep;
        this.emit();
    }
    /**
     * Accepte un morceau de stdout, même si une ligne `[x/y]` est coupée entre
     * deux événements `data`. Les retours chariot de Ninja sont traités comme des lignes.
     */
    consumeOutput(chunk) {
        this.streamBuffer += stripAnsi(chunk);
        const lines = this.streamBuffer.split(/\r\n|\n|\r/);
        this.streamBuffer = lines.pop() || "";
        for (const line of lines)
            this.consumeLine(line);
        // Ninja peut laisser la ligne courante sans saut de ligne pendant un moment.
        this.consumeLine(this.streamBuffer);
    }
    /** Termine l'opération et arrête le compteur de durée. */
    finish(success, message) {
        this.stopTimer();
        this.active = false;
        this.phase = success ? "complete" : "error";
        this.currentStep = message;
        if (success) {
            this.progressPercent = 100;
            if (this.measured)
                this.completedSteps = this.totalSteps;
        }
        this.emit();
    }
    dispose() {
        this.stopTimer();
    }
    consumeLine(line) {
        const match = line.match(/\[\s*(\d+)\s*\/\s*(\d+)\s*\]\s*(.*)$/);
        if (!match)
            return;
        const completed = Number.parseInt(match[1], 10);
        const total = Number.parseInt(match[2], 10);
        if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0)
            return;
        const signature = `${completed}/${total}:${match[3]}`;
        if (signature === this.lastNinjaProgress)
            return;
        this.lastNinjaProgress = signature;
        this.phase = "building";
        this.completedSteps = Math.max(0, Math.min(completed, total));
        this.totalSteps = total;
        this.progressPercent = Math.round((this.completedSteps / total) * 100);
        this.measured = true;
        this.currentStep = match[3].trim() || `Tâche Ninja ${completed}/${total}`;
        this.emit();
    }
    emit() {
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
    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
}
exports.ProgressManager = ProgressManager;
//# sourceMappingURL=progressManager.js.map