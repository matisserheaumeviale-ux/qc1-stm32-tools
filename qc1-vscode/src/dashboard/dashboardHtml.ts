/**
 * RÉSUMÉ DU FICHIER — INTERFACE HTML DU TABLEAU DE BORD QC1
 *
 * Ce fichier fabrique toute la Webview QC1 (HTML + CSS + JavaScript embarqué).
 * Il reçoit un `DashboardState` déjà calculé par `extension.ts` et retourne une
 * grande chaîne HTML à afficher dans la barre latérale de VS Code.
 *
 * Où modifier quoi :
 * - fonctions du haut : petits composants HTML réutilisables;
 * - bloc `<style>` : couleurs, disposition, cartes et barre de progression;
 * - bloc `<body>` : onglets Dashboard, Terminal et Paramètres;
 * - bloc `<script>` : clics utilisateur et messages échangés avec extension.ts.
 *
 * Barre de progression : `ProgressManager` lit `[x/y]` dans stdout de Ninja,
 * `extension.ts` envoie un message progress, puis le script modifie le DOM en direct.
 */

import { DashboardState } from "./dashboardState";

// Petit composant qui affiche un badge vert ou neutre selon une valeur booléenne.
function statusBadge(value: boolean, okText = "OK", failText = "--"): string {
  return value
    ? `<span class="badge badge-ok">${okText}</span>`
    : `<span class="badge badge-muted">${failText}</span>`;
}

// Traduit le niveau logique du diagnostic en classe CSS.
function diagnosticClass(level: string): string {
  switch (level) {
    case "success":
      return "diag-success";
    case "warning":
      return "diag-warning";
    case "error":
      return "diag-error";
    case "info":
      return "diag-info";
    default:
      return "diag-idle";
  }
}

// Convertit une durée interne en millisecondes vers un texte lisible.
function formatMs(ms: number): string {
  if (!ms || ms <= 0) return "--";
  return `${(ms / 1000).toFixed(1)} s`;
}

// Rend les phases techniques compréhensibles sans exposer les noms internes anglais.
function progressPhaseLabel(phase: DashboardState["progress"]["phase"]): string {
  const labels: Record<DashboardState["progress"]["phase"], string> = {
    idle: "Prêt",
    preparing: "Préparation",
    configuring: "Configuration",
    cleaning: "Nettoyage",
    building: "Compilation",
    flashing: "Flash",
    complete: "Terminé",
    error: "Erreur"
  };
  return labels[phase];
}

// Ninja est la seule phase qui fournit un compteur exact `[x/y]`.
function progressCounterLabel(progress: DashboardState["progress"]): string {
  if (progress.measured && progress.totalSteps > 0) {
    return `${progress.completedSteps} / ${progress.totalSteps}`;
  }
  return progress.phase === "building" ? "En attente de Ninja" : "Étape non mesurée";
}

/**
 * Construit la barre visible avec compteur réel, phase, étape et durée.
 * `safePercent` protège le CSS en forçant une valeur entre 0 et 100.
 */
function progressBar(progress: DashboardState["progress"]): string {
  const safePercent = Math.max(0, Math.min(100, progress.progressPercent));
  const counter = progressCounterLabel(progress);

  return `
    <div class="progress-track" role="progressbar" aria-label="Progression Ninja" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${safePercent}">
      <div id="progressFill" class="progress-fill" style="width: ${safePercent}%"></div>
      <div class="progress-glow"></div>
    </div>
    <div class="progress-meta">
      <span id="progressCounter" class="progress-counter">${counter}</span>
      <span id="progressPercent" class="progress-text">${safePercent}%</span>
    </div>
  `;
}

/** Reconstruit le document complet à partir d'une photographie de l'état QC1. */
export function getDashboardHtml(state: DashboardState): string {
  const diagnosticStyle = diagnosticClass(state.diagnostic.level);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    /* === THÈME : variables reliées aux couleurs actives de VS Code === */
    :root {
      --bg: var(--vscode-editor-background);
      --panel: color-mix(in srgb, var(--vscode-sideBar-background) 84%, transparent);
      --panel-2: color-mix(in srgb, var(--vscode-sideBar-background) 92%, var(--vscode-editor-background));
      --border: color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-button-background);
      --accent-2: var(--vscode-progressBar-background);
      --fg: var(--vscode-editor-foreground);
      --success: #49d17d;
      --warning: #ffbd5b;
      --danger: #ff6875;
      --shadow: 0 16px 42px rgba(0, 0, 0, 0.16);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 18px;
      font-family: var(--vscode-font-family);
      background:
        radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 18%, transparent), transparent 34%),
        linear-gradient(180deg, color-mix(in srgb, var(--bg) 88%, #09111a) 0%, var(--bg) 100%);
      color: var(--fg);
    }

    .shell {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .hero, .card, .progress-card, .terminal-frame, .diagnostic {
      border: 1px solid var(--border);
      border-radius: 18px;
      background: linear-gradient(145deg, var(--panel), var(--panel-2));
      box-shadow: var(--shadow);
    }

    .hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px;
      overflow: hidden;
      position: relative;
    }

    .hero::after {
      content: "";
      position: absolute;
      width: 180px;
      height: 180px;
      right: -80px;
      top: -100px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--accent) 20%, transparent);
      filter: blur(8px);
      pointer-events: none;
    }

    .hero-main { min-width: 0; z-index: 1; }

    .hero-kicker {
      color: var(--accent-2);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      margin-bottom: 5px;
    }

    .hero-title {
      font-size: 20px;
      font-weight: 800;
      margin-bottom: 4px;
    }

    .version-badge, .tab, .terminal-chip, .badge {
      border-radius: 999px;
    }

    .version-badge {
      display: inline-block;
      margin-left: 8px;
      padding: 3px 9px;
      font-size: 12px;
      font-weight: 800;
      background: color-mix(in srgb, var(--accent) 18%, transparent);
      color: var(--muted);
    }

    .hero-subtitle {
      color: var(--muted);
      font-size: 13px;
    }

    .hero-status {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 7px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: color-mix(in srgb, var(--panel-2) 88%, transparent);
      font-size: 11px;
      font-weight: 800;
      z-index: 1;
      white-space: nowrap;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 10px color-mix(in srgb, var(--success) 70%, transparent);
    }

    .status-dot.busy { background: var(--warning); }
    .status-dot.error { background: var(--danger); }

    .tabs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .tab {
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--fg);
      padding: 10px 12px;
      font-weight: 800;
      cursor: pointer;
    }

    .tab.active {
      background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 82%, white), var(--accent));
      color: var(--vscode-button-foreground);
      border-color: transparent;
    }

    .panel { display: none; }
    .panel.active { display: block; }

    .dashboard {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .progress-card {
      padding: 18px;
      border-color: color-mix(in srgb, var(--accent-2) 42%, var(--border));
    }

    .progress-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }

    .progress-title-line {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 5px;
    }

    .phase-badge {
      padding: 3px 8px;
      border-radius: 999px;
      color: var(--accent-2);
      background: color-mix(in srgb, var(--accent-2) 14%, transparent);
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .runtime-chip {
      min-width: 76px;
      padding: 8px 10px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--panel-2) 82%, transparent);
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .current-step {
      min-height: 20px;
      color: var(--muted);
      font-size: 12px;
      margin-top: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .command-dock {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
      gap: 10px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: color-mix(in srgb, var(--panel) 82%, transparent);
    }

    .primary-actions, .utility-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .primary-actions button { flex: 1 1 92px; }
    .utility-actions button { flex: 1 1 110px; }

    .primary-action {
      min-height: 42px;
      box-shadow: 0 8px 18px color-mix(in srgb, var(--accent) 22%, transparent);
    }

    .hardware-strip {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      padding: 2px 1px;
    }

    .hardware-strip .strip-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
      margin-right: 2px;
    }

    .hardware-strip button {
      flex: 0 0 auto;
      padding: 7px 10px;
      border-radius: 999px;
      font-size: 11px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .card, .diagnostic {
      padding: 14px;
    }

    .metric-card { position: relative; overflow: hidden; }
    .metric-card::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: var(--accent-2);
      opacity: 0.7;
    }

    .card-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      font-weight: 800;
      margin-bottom: 10px;
    }

    .big-value {
      font-size: 24px;
      font-weight: 900;
      margin-bottom: 8px;
    }

    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
      font-size: 13px;
    }

    .row:last-child { border-bottom: none; }
    .label { color: var(--muted); }
    .value { font-weight: 700; text-align: right; }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 800;
    }

    .badge-ok {
      background: rgba(80, 200, 120, 0.16);
      color: #55d17a;
    }

    .badge-muted {
      background: rgba(127,127,127,0.18);
      color: var(--muted);
    }

    .diag-success { background: rgba(80, 200, 120, 0.10); }
    .diag-warning { background: rgba(255, 180, 60, 0.10); }
    .diag-error { background: rgba(255, 80, 80, 0.10); }
    .diag-info { background: rgba(80, 150, 255, 0.10); }
    .diag-idle { background: rgba(127,127,127,0.10); }

    .diag-code {
      font-size: 28px;
      font-weight: 900;
      margin-bottom: 4px;
    }

    .diag-title {
      font-weight: 800;
      margin-bottom: 6px;
    }

    .diag-message {
      color: var(--fg);
      opacity: 0.88;
      font-size: 13px;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    button {
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 10px;
      padding: 9px 12px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      cursor: pointer;
      font-weight: 800;
    }

    button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.48;
      box-shadow: none;
    }

    .secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    /* === BARRE DE PROGRESSION : piste, remplissage animé et pourcentage === */
    .progress-track {
      width: 100%;
      height: 14px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--panel-2) 72%, #000);
      overflow: hidden;
      position: relative;
    }

    .progress-fill {
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--accent), var(--accent-2), #67c8ff);
      transition: width 0.18s ease-out;
      position: relative;
      z-index: 1;
    }

    .progress-fill::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(110deg, transparent 20%, rgba(255,255,255,0.28) 48%, transparent 76%);
      animation: progress-shine 1.5s linear infinite;
    }

    @keyframes progress-shine {
      from { transform: translateX(-100%); }
      to { transform: translateX(100%); }
    }

    .progress-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 8px;
    }

    .progress-counter {
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }

    .progress-text {
      font-weight: 800;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
    }

    .terminal {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .terminal-frame {
      padding: 14px;
    }

    .terminal-title {
      font-size: 18px;
      font-weight: 900;
      margin-bottom: 10px;
    }

    .terminal-meta {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 13px;
    }

    .terminal-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .terminal-chip {
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--fg);
      padding: 8px 12px;
      font-weight: 800;
      cursor: pointer;
    }

    .terminal-output {
      min-height: 280px;
      max-height: 46vh;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.5;
      background: #06090c;
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px;
    }

    .line {
      margin-bottom: 4px;
    }

    .line.command { color: #6cc7ff; }
    .line.stdout { color: #d7e4ec; }
    .line.stderr { color: #ffd173; }
    .line.error { color: #ff8d8d; }
    .line.separator { color: #7f8c96; }

    .analysis-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .analysis-entry {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 12px;
      background: var(--panel-2);
      font-size: 13px;
    }

    .analysis-entry.warning {
      border-color: rgba(255, 180, 60, 0.4);
    }

    .analysis-entry.error {
      border-color: rgba(255, 80, 80, 0.4);
    }

    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      word-break: break-word;
    }

    .settings {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .section-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .path-box {
      margin-top: 6px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--panel-2) 80%, #040608);
      font-size: 12px;
      color: var(--muted);
    }

    @media (max-width: 920px) {
      .grid, .grid-2, .section-grid, .command-dock {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 520px) {
      body { padding: 10px; }
      .hero { align-items: flex-start; }
      .hero-status { display: none; }
      .progress-head { align-items: flex-start; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <!-- Structure générale de la Webview. Chaque onglet correspond à un <section>. -->
  <div class="shell">
    <section class="hero">
      <div class="hero-main">
        <div class="hero-kicker">Environnement embarqué</div>
        <div class="hero-title">
          QC1 STM32 <span class="version-badge">v${state.environment.extensionVersion}</span>
        </div>
        <div class="hero-subtitle">
          <span id="heroProject">${state.projectName}</span> · <span id="heroLastCommand">${state.lastCommand}</span> · ${state.environment.os}
        </div>
      </div>
      <div class="hero-status">
        <span id="heroDot" class="status-dot"></span>
        <span id="heroStatus">${state.project.projectDetected ? "Projet prêt" : "À vérifier"}</span>
      </div>
    </section>

    <section class="tabs">
      <button class="tab active" data-panel="dashboardPanel" onclick="showPanel(event, 'dashboardPanel')">Dashboard</button>
      <button class="tab" data-panel="terminalPanel" onclick="showPanel(event, 'terminalPanel')">Terminal</button>
      <button class="tab" data-panel="settingsPanel" onclick="showPanel(event, 'settingsPanel')">Parametres</button>
    </section>

    <!-- ONGLET DASHBOARD : progression, commandes rapides et état STM32. -->
    <section id="dashboardPanel" class="panel active">
      <div class="dashboard">
        <!-- Le contenu est ensuite mis à jour en direct par les messages progress. -->
        <section class="progress-card">
          <div class="progress-head">
            <div>
              <div class="progress-title-line">
                <div class="card-title" style="margin:0">Progression réelle</div>
                <span id="progressPhase" class="phase-badge">${progressPhaseLabel(state.progress.phase)}</span>
              </div>
              <div id="progressTask" class="big-value">${state.progress.taskName || "Prêt à compiler"}</div>
            </div>
            <div class="runtime-chip"><span id="progressRuntime">${state.progress.runtimeSeconds}</span> s</div>
          </div>
          ${progressBar(state.progress)}
          <div id="progressStep" class="current-step">${state.progress.currentStep || "La prochaine sortie Ninja apparaîtra ici."}</div>
        </section>

        <section class="command-dock">
          <div class="primary-actions">
            <button data-task-command class="primary-action" onclick="sendCommand('build')">Compiler</button>
            <button data-task-command class="primary-action" onclick="sendCommand('flash')">Flasher</button>
            <button data-task-command class="primary-action" onclick="sendCommand('run')">Compiler + flasher</button>
          </div>
          <div class="utility-actions">
            <button onclick="sendCommand('status')" class="secondary">Vérifier</button>
            <button data-task-command onclick="sendCommand('clean')" class="secondary">Nettoyer</button>
            <button onclick="sendCommand('openLogs')" class="secondary">Journaux</button>
            <button onclick="createDiagnosticReport()" class="secondary">Rapport</button>
          </div>
        </section>

        <section class="hardware-strip" aria-label="Outils matériels">
          <span class="strip-label">Matériel</span>
          <button onclick="sendCommand('detect-stlink')" class="secondary">Détecter ST-Link</button>
          <button onclick="sendCommand('open-serial')" class="secondary">Moniteur série</button>
          <button onclick="sendCommand('start-openocd')" class="secondary">Serveur OpenOCD</button>
        </section>

        <section class="grid">
          <div class="card metric-card">
            <div class="card-title">Build</div>
            <div id="buildStatusValue" class="big-value">${state.build.lastBuildSuccess ? "Réussi" : "--"}</div>
            <div class="row"><span class="label">Dernier build</span><span id="buildTime" class="value">${state.build.lastBuildTime}</span></div>
            <div class="row"><span class="label">Durée</span><span id="buildRuntime" class="value">${formatMs(state.build.buildRuntimeMs)}</span></div>
            <div class="row"><span class="label">Erreurs</span><span id="buildErrors" class="value">${state.build.errors}</span></div>
            <div class="row"><span class="label">Avertissements</span><span id="buildWarnings" class="value">${state.build.warnings}</span></div>
          </div>

          <div class="card metric-card">
            <div class="card-title">Flash</div>
            <div id="flashStatusValue" class="big-value">${state.flash.lastFlashSuccess ? "Réussi" : "--"}</div>
            <div class="row"><span class="label">Dernier flash</span><span id="flashTime" class="value">${state.flash.lastFlashTime}</span></div>
            <div class="row"><span class="label">Durée</span><span id="flashRuntime" class="value">${formatMs(state.flash.flashRuntimeMs)}</span></div>
            <div class="row"><span class="label">Méthode</span><span id="flashMethod" class="value">${state.flash.method}</span></div>
            <div class="row"><span class="label">MCU</span><span id="flashMcu" class="value">${state.flash.targetMCU}</span></div>
          </div>

          <div class="card metric-card">
            <div class="card-title">Projet</div>
            <div id="projectStatusValue" class="big-value">${state.project.projectStatus}</div>
            <div class="row"><span class="label">Workspace</span><span class="value">${statusBadge(state.project.workspaceOpened, "OK", "erreur")}</span></div>
            <div class="row"><span class="label">Projet CMake</span><span class="value">${statusBadge(state.project.cmakeProjectReady, "OK", "introuvable")}</span></div>
            <div class="row"><span class="label">Core (optionnel)</span><span class="value">${statusBadge(state.project.coreFolderFound, "présent", "absent")}</span></div>
            <div class="row"><span class="label">Drivers (optionnel)</span><span class="value">${statusBadge(state.project.driversFolderFound, "présent", "absent")}</span></div>
            <div class="row"><span class="label">Startup F103</span><span class="value">${statusBadge(state.project.startupFound, "OK", "introuvable")}</span></div>
            <div class="row"><span class="label">Linker script</span><span class="value">${statusBadge(state.project.linkerScriptFound, "OK", "introuvable")}</span></div>
          </div>
        </section>

        <section class="grid-2">
          <div id="diagnosticCard" class="diagnostic ${diagnosticStyle}">
            <div class="card-title">Diagnostic</div>
            <div id="diagnosticCode" class="diag-code">${state.diagnostic.code}</div>
            <div id="diagnosticTitle" class="diag-title">${state.diagnostic.title}</div>
            <div id="diagnosticMessage" class="diag-message">${state.diagnostic.message}</div>
            <div class="row"><span class="label">Cause</span><span id="diagnosticCause" class="value">${state.diagnostic.cause}</span></div>
            <div class="row"><span class="label">Chemin vérifié</span><span id="diagnosticPath" class="value mono">${state.diagnostic.checkedPath}</span></div>
          </div>

          <div class="card">
            <div class="card-title">Toolchain</div>
            <div class="row"><span class="label">CMake</span><span class="value">${statusBadge(state.environment.cmakeDetected)}</span></div>
            <div class="row"><span class="label">GCC ARM</span><span class="value">${statusBadge(state.environment.gccDetected)}</span></div>
            <div class="row"><span class="label">OpenOCD</span><span class="value">${statusBadge(state.environment.openocdDetected)}</span></div>
            <div class="row"><span class="label">st-flash installé</span><span class="value">${statusBadge(state.environment.stFlashInstalled)}</span></div>
            <div class="row"><span class="label">Probe ST-Link</span><span class="value">${state.environment.stlinkProbeStatus}</span></div>
            <div class="row"><span class="label">Mode portable</span><span class="value">${statusBadge(state.environment.offlinePortable)}</span></div>
          </div>
        </section>
      </div>
    </section>

    <!-- ONGLET TERMINAL : copie visuelle des sorties envoyées par extension.ts. -->
    <section id="terminalPanel" class="panel">
      <div class="terminal">
        <section class="terminal-frame">
          <div class="terminal-title">Terminal QC1</div>
          <div class="terminal-meta">
            <div>Projet: <span id="terminalProject">${state.projectName}</span></div>
            <div>Dernière commande: <span id="terminalLastCommand">${state.lastCommand}</span></div>
          </div>
        </section>

        <section class="terminal-actions">
          <button class="terminal-chip" onclick="sendCommand('build')">cmake build</button>
          <button class="terminal-chip" onclick="sendCommand('clean')">clean</button>
          <button class="terminal-chip" onclick="sendCommand('flash')">flash</button>
          <button class="terminal-chip" onclick="sendCommand('status')">status</button>
          <button class="terminal-chip" onclick="clearTerminal()">clear</button>
          <button class="terminal-chip" onclick="copyOutput()">copy</button>
          <button class="terminal-chip" onclick="saveLog()">save</button>
          <button class="terminal-chip" onclick="createDiagnosticReport()">rapport</button>
        </section>

        <section class="terminal-frame">
          <div id="output" class="terminal-output">QC1 prêt.</div>
        </section>

        <section class="grid-2">
          <div class="terminal-frame">
            <div class="card-title">Analyse QC1</div>
            <div class="row"><span class="label">Erreurs</span><span id="analysisErrors" class="value">${state.build.errors}</span></div>
            <div class="row"><span class="label">Warnings</span><span id="analysisWarnings" class="value">${state.build.warnings}</span></div>
            <div class="row"><span class="label">Explication</span><span id="analysisExplanation" class="value">Aucune erreur connue détectée.</span></div>
          </div>

          <div class="terminal-frame">
            <div class="card-title">Erreurs connues</div>
            <div id="analysisList" class="analysis-list">
              <div class="analysis-entry">Aucune sortie analysée pour le moment.</div>
            </div>
          </div>
        </section>
      </div>
    </section>

    <!-- ONGLET PARAMÈTRES : lecture de la configuration et des chemins détectés. -->
    <section id="settingsPanel" class="panel">
      <div class="settings">
        <section class="section-grid">
          <div class="card">
            <div class="card-title">Chemins QC1</div>
            <div class="row"><span class="label">OS détecté</span><span id="sOs" class="value">${state.environment.os}</span></div>
            <div class="row"><span class="label">Projet CMake</span><span id="sQuickMode" class="value">intégré au VSIX</span></div>
            <div id="sPath" class="path-box mono">${state.environment.cmakeSourcePath}</div>
          </div>

          <div class="card">
            <div class="card-title">Toolchain</div>
            <div class="row"><span class="label">CMake utilisé</span><span id="sCmakeSource" class="value">détecté</span></div>
            <div class="row"><span class="label">Chemin CMake</span><span id="sCmakePathLabel" class="value">voir ci-dessous</span></div>
            <div id="sCmakePath" class="path-box mono">${state.environment.cmakePath}</div>
            <div class="row"><span class="label">Dossier de build</span><span id="sBuildPathLabel" class="value">géré par QC1</span></div>
            <div id="sBuildPath" class="path-box mono">${state.environment.buildPath}</div>
          </div>
        </section>

        <section class="section-grid">
          <div class="card">
            <div class="card-title">Flash</div>
            <div class="row"><span class="label">OpenOCD</span><span id="toolOpenocdPathLabel" class="value">--</span></div>
            <div id="toolOpenocdPath" class="path-box mono">--</div>
            <div class="row"><span class="label">st-flash installé</span><span id="toolStFlashPathLabel" class="value">--</span></div>
            <div id="toolStFlashPath" class="path-box mono">--</div>
            <div class="row"><span class="label">Probe ST-Link</span><span id="toolStlinkProbeLabel" class="value">${state.environment.stlinkProbeStatus}</span></div>
          </div>

          <div class="card">
            <div class="card-title">UI</div>
            <div class="row"><span class="label">Version extension</span><span id="sVersion" class="value">${state.environment.extensionVersion}</span></div>
            <div class="row"><span class="label">Mode offline/portable</span><span id="sPortable" class="value">${state.environment.offlinePortable ? "Oui" : "Non"}</span></div>
            <div class="row"><span class="label">Timestamps</span><span id="sTimestamps" class="value">--</span></div>
            <div class="row"><span class="label">Auto-clear</span><span id="sAutoClear" class="value">--</span></div>
          </div>
        </section>

        <section class="section-grid">
          <div class="card">
            <div class="card-title">Diagnostics</div>
            <div class="row"><span class="label">Projet</span><span id="toolProjectPathLabel" class="value">--</span></div>
            <div id="toolProjectPath" class="path-box mono">--</div>
            <div class="row"><span class="label">Projet CMake intégré</span><span id="toolCmakeSourcePathLabel" class="value">--</span></div>
            <div id="toolCmakeSourcePath" class="path-box mono">--</div>
          </div>

          <div class="card">
            <div class="card-title">Actions</div>
            <div class="actions">
              <button onclick="verifyConfig()">Vérifier configuration</button>
              <button class="secondary" onclick="openExtensionFolder()">Ouvrir dossier extension</button>
              <button class="secondary" onclick="openProjectFolder()">Ouvrir dossier projet</button>
              <button class="secondary" onclick="copyDiagnostic()">Copier diagnostic</button>
              <button class="secondary" onclick="createDiagnosticReport()">Créer un rapport complet</button>
            </div>
          </div>
        </section>
      </div>
    </section>
  </div>

  <script>
    // Pont officiel VS Code. postMessage envoie une action à QC1PanelProvider.
    const vscode = acquireVsCodeApi();

    function showPanel(event, id) {
      document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      document.getElementById(id).classList.add("active");
      event.target.classList.add("active");
    }

    // Tous les boutons de commande passent par ce message générique.
    function sendCommand(command) {
      vscode.postMessage({ type: "command", command });
    }

    function clearTerminal() {
      vscode.postMessage({ type: "clear" });
    }

    function copyOutput() {
      vscode.postMessage({ type: "copyOutput" });
    }

    function saveLog() {
      vscode.postMessage({ type: "saveLog" });
    }

    function createDiagnosticReport() {
      vscode.postMessage({ type: "createDiagnosticReport" });
    }

    function verifyConfig() {
      vscode.postMessage({ type: "refreshTools" });
    }

    function openExtensionFolder() {
      vscode.postMessage({ type: "openExtensionFolder" });
    }

    function openProjectFolder() {
      vscode.postMessage({ type: "openProjectFolder" });
    }

    function copyDiagnostic() {
      vscode.postMessage({ type: "copyDiagnostic" });
    }

    // Ajoute les lignes reçues sans utiliser innerHTML, afin de ne pas exécuter la sortie.
    function appendLines(lines, kind) {
      const output = document.getElementById("output");

      if (output.textContent === "QC1 prêt.") {
        output.textContent = "";
      }

      for (const line of lines) {
        const div = document.createElement("div");
        div.className = "line " + kind;
        div.textContent = line;
        output.appendChild(div);
      }

      output.scrollTop = output.scrollHeight;
    }

    function setText(id, value, fallback) {
      const element = document.getElementById(id);
      if (element) element.textContent = value === undefined || value === null || value === "" ? (fallback || "--") : String(value);
    }

    function formatRuntime(ms) {
      return !ms || ms <= 0 ? "--" : (ms / 1000).toFixed(1) + " s";
    }

    function phaseLabel(phase) {
      const labels = {
        idle: "Prêt",
        preparing: "Préparation",
        configuring: "Configuration",
        cleaning: "Nettoyage",
        building: "Compilation",
        flashing: "Flash",
        complete: "Terminé",
        error: "Erreur"
      };
      return labels[phase] || phase || "Prêt";
    }

    /** Met à jour la progression réelle sans reconstruire la page ni perdre le terminal. */
    function setProgress(progress) {
      const percent = Math.max(0, Math.min(100, Number(progress.progressPercent) || 0));
      const fill = document.getElementById("progressFill");
      fill.style.width = percent + "%";
      fill.parentElement.setAttribute("aria-valuenow", String(percent));
      setText("progressPercent", percent + "%");
      setText("progressCounter", progress.measured && progress.totalSteps > 0
        ? progress.completedSteps + " / " + progress.totalSteps
        : progress.phase === "building" ? "En attente de Ninja" : "Étape non mesurée");
      setText("progressPhase", phaseLabel(progress.phase), "Prêt");
      setText("progressTask", progress.taskName, "Prêt à compiler");
      setText("progressRuntime", progress.runtimeSeconds, "0");
      setText("progressStep", progress.currentStep, "La prochaine sortie Ninja apparaîtra ici.");
      document.querySelectorAll("[data-task-command]").forEach((button) => {
        button.disabled = Boolean(progress.active);
      });
      const heroDot = document.getElementById("heroDot");
      heroDot.classList.toggle("busy", Boolean(progress.active));
      heroDot.classList.toggle("error", progress.phase === "error");
    }

    /** Rafraîchit les cartes de résultat à la fin d'une commande. */
    function setDashboardState(state) {
      setProgress(state.progress);
      setText("heroProject", state.projectName);
      setText("heroLastCommand", state.lastCommand);
      setText("heroStatus", state.project.projectDetected ? "Projet prêt" : "À vérifier");
      setText("buildStatusValue", state.build.lastBuildSuccess ? "Réussi" : "Échec / non lancé");
      setText("buildTime", state.build.lastBuildTime);
      setText("buildRuntime", formatRuntime(state.build.buildRuntimeMs));
      setText("buildErrors", state.build.errors, "0");
      setText("buildWarnings", state.build.warnings, "0");
      setText("flashStatusValue", state.flash.lastFlashSuccess ? "Réussi" : "Échec / non lancé");
      setText("flashTime", state.flash.lastFlashTime);
      setText("flashRuntime", formatRuntime(state.flash.flashRuntimeMs));
      setText("flashMethod", state.flash.method);
      setText("flashMcu", state.flash.targetMCU);
      setText("projectStatusValue", state.project.projectStatus);
      setText("diagnosticCode", state.diagnostic.code);
      setText("diagnosticTitle", state.diagnostic.title);
      setText("diagnosticMessage", state.diagnostic.message);
      setText("diagnosticCause", state.diagnostic.cause);
      setText("diagnosticPath", state.diagnostic.checkedPath);

      const diagnosticCard = document.getElementById("diagnosticCard");
      diagnosticCard.classList.remove("diag-success", "diag-warning", "diag-error", "diag-info", "diag-idle");
      diagnosticCard.classList.add("diag-" + (state.diagnostic.level || "idle"));
    }

    // Met à jour seulement les champs de configuration déjà présents dans le DOM.
    function setSettings(settings) {
      document.getElementById("sPath").textContent = settings.cmakeSourcePath || "--";
      document.getElementById("sOs").textContent = settings.os || "--";
      document.getElementById("sVersion").textContent = settings.extensionVersion || "--";
      document.getElementById("sPortable").textContent = settings.offlinePortable ? "Oui" : "Non";
      document.getElementById("sQuickMode").textContent = settings.cmakeMode || "--";
      document.getElementById("sCmakeSource").textContent = settings.cmakeSource || "--";
      document.getElementById("sCmakePath").textContent = settings.detectedCmakePath || "--";
      document.getElementById("sBuildPath").textContent = settings.buildPath || "--";
      document.getElementById("sTimestamps").textContent = String(settings.showTimestamps);
      document.getElementById("sAutoClear").textContent = String(settings.autoClearOutput);
    }

    function setToolsStatus(tools) {
      document.getElementById("toolProjectPathLabel").textContent = tools.projectOk ? "OK" : "introuvable";
      document.getElementById("toolProjectPath").textContent = tools.projectPath || "--";
      document.getElementById("toolCmakeSourcePathLabel").textContent = tools.cmakeProjectReady ? "OK" : "introuvable";
      document.getElementById("toolCmakeSourcePath").textContent = tools.cmakeSourcePath || "--";
      document.getElementById("toolOpenocdPathLabel").textContent = tools.openocdOk ? "OK" : "introuvable";
      document.getElementById("toolOpenocdPath").textContent = tools.openocdPath || "--";
      document.getElementById("toolStFlashPathLabel").textContent = tools.stFlashOk ? "OK" : "introuvable";
      document.getElementById("toolStFlashPath").textContent = tools.stFlashPath || "--";
      document.getElementById("toolStlinkProbeLabel").textContent = tools.stlinkProbeStatus || "non testé";
    }

    function setTerminalMeta(meta) {
      document.getElementById("terminalProject").textContent = meta.projectName || "--";
      document.getElementById("terminalLastCommand").textContent = meta.lastCommand || "--";
    }

    function setAnalysis(analysis) {
      document.getElementById("analysisErrors").textContent = String(analysis.errors ?? 0);
      document.getElementById("analysisWarnings").textContent = String(analysis.warnings ?? 0);
      document.getElementById("analysisExplanation").textContent = analysis.explanation || "Aucune erreur connue détectée.";

      const list = document.getElementById("analysisList");
      list.textContent = "";

      const diagnostics = Array.isArray(analysis.diagnostics) ? analysis.diagnostics : [];

      if (diagnostics.length === 0) {
        const empty = document.createElement("div");
        empty.className = "analysis-entry";
        empty.textContent = "Aucune sortie analysée pour le moment.";
        list.appendChild(empty);
        return;
      }

      diagnostics.slice(0, 8).forEach((entry) => {
        const div = document.createElement("div");
        div.className = "analysis-entry " + entry.severity;
        div.textContent = entry.raw;
        list.appendChild(div);
      });
    }

    // Sens inverse du pont : extension.ts -> Webview.
    // Les valeurs de msg.type doivent correspondre aux postMessage() du provider.
    window.addEventListener("message", (event) => {
      const msg = event.data;

      if (msg.type === "output") {
        appendLines(msg.lines, msg.kind);
      }

      if (msg.type === "progress") {
        setProgress(msg.progress);
      }

      if (msg.type === "dashboardState") {
        setDashboardState(msg.state);
      }

      if (msg.type === "status") {
        setText("heroStatus", msg.text);
        const heroDot = document.getElementById("heroDot");
        heroDot.classList.toggle("busy", msg.state === "running");
        heroDot.classList.toggle("error", msg.state === "error");
      }

      if (msg.type === "clearOutput") {
        document.getElementById("output").textContent = "QC1 prêt.";
      }

      if (msg.type === "settings") {
        setSettings(msg.settings);
      }

      if (msg.type === "toolsStatus") {
        setToolsStatus(msg.tools);
      }

      if (msg.type === "terminalMeta") {
        setTerminalMeta(msg.meta);
      }

      if (msg.type === "analysis") {
        setAnalysis(msg.analysis);
      }
    });
  </script>
</body>
</html>`;
}
