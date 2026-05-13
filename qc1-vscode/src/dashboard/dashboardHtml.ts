import { DashboardState } from "./dashboardState";

function statusBadge(value: boolean, okText = "OK", failText = "--"): string {
  return value
    ? `<span class="badge badge-ok">${okText}</span>`
    : `<span class="badge badge-muted">${failText}</span>`;
}

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

function formatMs(ms: number): string {
  if (!ms || ms <= 0) return "--";
  return `${(ms / 1000).toFixed(1)} s`;
}

function progressBar(percent: number): string {
  const safePercent = Math.max(0, Math.min(100, percent));

  return `
    <div class="progress-track">
      <div class="progress-fill" style="width: ${safePercent}%"></div>
    </div>
    <div class="progress-text">${safePercent}%</div>
  `;
}

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
    :root {
      --bg: var(--vscode-editor-background);
      --panel: color-mix(in srgb, var(--vscode-sideBar-background) 84%, transparent);
      --panel-2: color-mix(in srgb, var(--vscode-sideBar-background) 92%, var(--vscode-editor-background));
      --border: color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-button-background);
      --accent-2: var(--vscode-progressBar-background);
      --fg: var(--vscode-editor-foreground);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 16px;
      font-family: var(--vscode-font-family);
      background:
        radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 18%, transparent), transparent 34%),
        linear-gradient(180deg, color-mix(in srgb, var(--bg) 88%, #09111a) 0%, var(--bg) 100%);
      color: var(--fg);
    }

    .shell {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .hero, .card, .progress-card, .terminal-frame, .diagnostic {
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--panel);
      backdrop-filter: blur(6px);
    }

    .hero {
      padding: 16px;
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
      padding: 14px;
    }

    .progress-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
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

    .secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .progress-track {
      width: 100%;
      height: 12px;
      border-radius: 999px;
      background: rgba(127,127,127,0.18);
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      border-radius: 999px;
      background: var(--accent-2);
      transition: width 0.25s ease;
    }

    .progress-text {
      margin-top: 6px;
      text-align: right;
      font-weight: 800;
      font-size: 13px;
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
      .grid, .grid-2, .section-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="hero-title">
        QC1 STM32 Tools <span class="version-badge">v${state.environment.extensionVersion}</span>
      </div>
      <div class="hero-subtitle">
        OS: ${state.environment.os} · Projet: ${state.projectName} · Derniere commande: ${state.lastCommand}
      </div>
    </section>

    <section class="tabs">
      <button class="tab active" data-panel="dashboardPanel" onclick="showPanel(event, 'dashboardPanel')">Dashboard</button>
      <button class="tab" data-panel="terminalPanel" onclick="showPanel(event, 'terminalPanel')">Terminal</button>
      <button class="tab" data-panel="settingsPanel" onclick="showPanel(event, 'settingsPanel')">Parametres</button>
    </section>

    <section id="dashboardPanel" class="panel active">
      <div class="dashboard">
        <section class="progress-card">
          <div class="progress-head">
            <div>
              <div class="card-title">Progression tâche active</div>
              <div class="big-value">${state.progress.taskName || "Aucune tâche"}</div>
            </div>
            <div class="value">Runtime: ${state.progress.runtimeSeconds}s</div>
          </div>
          ${progressBar(state.progress.progressPercent)}
          <div class="row">
            <span class="label">Etape</span>
            <span class="value">${state.progress.currentStep || "--"}</span>
          </div>
        </section>

        <section class="actions">
          <button onclick="sendCommand('make')">Build</button>
          <button onclick="sendCommand('clean')" class="secondary">Clean</button>
          <button onclick="sendCommand('flash')">Flash</button>
          <button onclick="sendCommand('status')" class="secondary">Status</button>
          <button onclick="sendCommand('openLogs')" class="secondary">Open Logs</button>
        </section>

        <section class="grid">
          <div class="card">
            <div class="card-title">Build</div>
            <div class="big-value">${state.build.lastBuildSuccess ? "OK" : "--"}</div>
            <div class="row"><span class="label">Dernier build</span><span class="value">${state.build.lastBuildTime}</span></div>
            <div class="row"><span class="label">Duree</span><span class="value">${formatMs(state.build.buildRuntimeMs)}</span></div>
            <div class="row"><span class="label">Erreurs C</span><span class="value">${state.build.errors}</span></div>
            <div class="row"><span class="label">Warnings C</span><span class="value">${state.build.warnings}</span></div>
          </div>

          <div class="card">
            <div class="card-title">Flash</div>
            <div class="big-value">${state.flash.lastFlashSuccess ? "OK" : "--"}</div>
            <div class="row"><span class="label">Dernier flash</span><span class="value">${state.flash.lastFlashTime}</span></div>
            <div class="row"><span class="label">Duree</span><span class="value">${formatMs(state.flash.flashRuntimeMs)}</span></div>
            <div class="row"><span class="label">Methode</span><span class="value">${state.flash.method}</span></div>
            <div class="row"><span class="label">MCU</span><span class="value">${state.flash.targetMCU}</span></div>
          </div>

          <div class="card">
            <div class="card-title">Projet</div>
            <div class="big-value">${state.project.projectDetected ? "OK" : "--"}</div>
            <div class="row"><span class="label">Workspace</span><span class="value">${statusBadge(state.project.workspaceOpened)}</span></div>
            <div class="row"><span class="label">Makefile</span><span class="value">${statusBadge(state.project.makefileFound)}</span></div>
            <div class="row"><span class="label">Core</span><span class="value">${statusBadge(state.project.coreFolderFound)}</span></div>
            <div class="row"><span class="label">Drivers</span><span class="value">${statusBadge(state.project.driversFolderFound)}</span></div>
          </div>
        </section>

        <section class="grid-2">
          <div class="diagnostic ${diagnosticStyle}">
            <div class="card-title">Diagnostic</div>
            <div class="diag-code">${state.diagnostic.code}</div>
            <div class="diag-title">${state.diagnostic.title}</div>
            <div class="diag-message">${state.diagnostic.message}</div>
          </div>

          <div class="card">
            <div class="card-title">Toolchain</div>
            <div class="row"><span class="label">make</span><span class="value">${statusBadge(state.environment.makeDetected)}</span></div>
            <div class="row"><span class="label">GCC ARM</span><span class="value">${statusBadge(state.environment.gccDetected)}</span></div>
            <div class="row"><span class="label">OpenOCD</span><span class="value">${statusBadge(state.environment.openocdDetected)}</span></div>
            <div class="row"><span class="label">ST-Link</span><span class="value">${statusBadge(state.environment.stlinkDetected)}</span></div>
            <div class="row"><span class="label">Mode portable</span><span class="value">${statusBadge(state.environment.offlinePortable)}</span></div>
          </div>
        </section>
      </div>
    </section>

    <section id="terminalPanel" class="panel">
      <div class="terminal">
        <section class="terminal-frame">
          <div class="terminal-title">Terminal QC1</div>
          <div class="terminal-meta">
            <div>Projet: <span id="terminalProject">${state.projectName}</span></div>
            <div>Derniere commande: <span id="terminalLastCommand">${state.lastCommand}</span></div>
          </div>
        </section>

        <section class="terminal-actions">
          <button class="terminal-chip" onclick="sendCommand('make')">make</button>
          <button class="terminal-chip" onclick="sendCommand('clean')">clean</button>
          <button class="terminal-chip" onclick="sendCommand('flash')">flash</button>
          <button class="terminal-chip" onclick="sendCommand('status')">status</button>
          <button class="terminal-chip" onclick="clearTerminal()">clear</button>
          <button class="terminal-chip" onclick="copyOutput()">copy</button>
          <button class="terminal-chip" onclick="saveLog()">save</button>
        </section>

        <section class="terminal-frame">
          <div id="output" class="terminal-output">QC1 pret.</div>
        </section>

        <section class="grid-2">
          <div class="terminal-frame">
            <div class="card-title">Analyse QC1</div>
            <div class="row"><span class="label">Erreurs</span><span id="analysisErrors" class="value">${state.build.errors}</span></div>
            <div class="row"><span class="label">Warnings</span><span id="analysisWarnings" class="value">${state.build.warnings}</span></div>
            <div class="row"><span class="label">Explication</span><span id="analysisExplanation" class="value">Aucune erreur connue detectee.</span></div>
          </div>

          <div class="terminal-frame">
            <div class="card-title">Erreurs connues</div>
            <div id="analysisList" class="analysis-list">
              <div class="analysis-entry">Aucune sortie analysee pour le moment.</div>
            </div>
          </div>
        </section>
      </div>
    </section>

    <section id="settingsPanel" class="panel">
      <div class="settings">
        <section class="section-grid">
          <div class="card">
            <div class="card-title">Chemins QC1</div>
            <div class="row"><span class="label">OS detecte</span><span id="sOs" class="value">${state.environment.os}</span></div>
            <div class="row"><span class="label">Quick-command utilise</span><span id="sQuickMode" class="value">auto</span></div>
            <div id="sPath" class="path-box mono">${state.environment.quickCommandPath}</div>
          </div>

          <div class="card">
            <div class="card-title">Toolchain</div>
            <div class="row"><span class="label">make utilise</span><span id="sMakeSource" class="value">${state.environment.bundledMakeUsed ? "bundled" : "systeme"}</span></div>
            <div class="row"><span class="label">Chemin make</span><span id="sMakePathLabel" class="value">voir ci-dessous</span></div>
            <div id="sMakePath" class="path-box mono">${state.environment.makePath}</div>
            <div class="row"><span class="label">make.exe Windows</span><span id="sBundledMakeLabel" class="value">si applicable</span></div>
            <div id="sBundledMakePath" class="path-box mono">${state.environment.bundledMakePath}</div>
          </div>
        </section>

        <section class="section-grid">
          <div class="card">
            <div class="card-title">Flash</div>
            <div class="row"><span class="label">OpenOCD</span><span id="toolOpenocdPathLabel" class="value">--</span></div>
            <div id="toolOpenocdPath" class="path-box mono">--</div>
            <div class="row"><span class="label">ST-Flash</span><span id="toolStFlashPathLabel" class="value">--</span></div>
            <div id="toolStFlashPath" class="path-box mono">--</div>
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
            <div class="row"><span class="label">Makefile</span><span id="toolMakefilePathLabel" class="value">--</span></div>
            <div id="toolMakefilePath" class="path-box mono">--</div>
          </div>

          <div class="card">
            <div class="card-title">Actions</div>
            <div class="actions">
              <button onclick="verifyConfig()">Verifier configuration</button>
              <button class="secondary" onclick="openExtensionFolder()">Ouvrir dossier extension</button>
              <button class="secondary" onclick="openProjectFolder()">Ouvrir dossier projet</button>
              <button class="secondary" onclick="copyDiagnostic()">Copier diagnostic</button>
            </div>
          </div>
        </section>
      </div>
    </section>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function showPanel(event, id) {
      document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
      document.getElementById(id).classList.add("active");
      event.target.classList.add("active");
    }

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

    function appendLines(lines, kind) {
      const output = document.getElementById("output");

      if (output.textContent === "QC1 pret.") {
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

    function setSettings(settings) {
      document.getElementById("sPath").textContent = settings.quickCommandPath || "auto";
      document.getElementById("sOs").textContent = settings.os || "--";
      document.getElementById("sVersion").textContent = settings.extensionVersion || "--";
      document.getElementById("sPortable").textContent = settings.offlinePortable ? "Oui" : "Non";
      document.getElementById("sQuickMode").textContent = settings.quickCommandPath ? "detecte" : "auto";
      document.getElementById("sMakeSource").textContent = settings.makeSource || "--";
      document.getElementById("sMakePath").textContent = settings.makePath || "--";
      document.getElementById("sBundledMakePath").textContent = settings.bundledMakePath || "--";
      document.getElementById("sTimestamps").textContent = String(settings.showTimestamps);
      document.getElementById("sAutoClear").textContent = String(settings.autoClearOutput);
    }

    function setToolsStatus(tools) {
      document.getElementById("toolProjectPathLabel").textContent = tools.projectOk ? "OK" : "introuvable";
      document.getElementById("toolProjectPath").textContent = tools.projectPath || "--";
      document.getElementById("toolMakefilePathLabel").textContent = tools.makefileOk ? "OK" : "introuvable";
      document.getElementById("toolMakefilePath").textContent = tools.makefileDir || "--";
      document.getElementById("toolOpenocdPathLabel").textContent = tools.openocdOk ? "OK" : "introuvable";
      document.getElementById("toolOpenocdPath").textContent = tools.openocdPath || "--";
      document.getElementById("toolStFlashPathLabel").textContent = tools.stFlashOk ? "OK" : "introuvable";
      document.getElementById("toolStFlashPath").textContent = tools.stFlashPath || "--";
    }

    function setTerminalMeta(meta) {
      document.getElementById("terminalProject").textContent = meta.projectName || "--";
      document.getElementById("terminalLastCommand").textContent = meta.lastCommand || "--";
    }

    function setAnalysis(analysis) {
      document.getElementById("analysisErrors").textContent = String(analysis.errors ?? 0);
      document.getElementById("analysisWarnings").textContent = String(analysis.warnings ?? 0);
      document.getElementById("analysisExplanation").textContent = analysis.explanation || "Aucune erreur connue detectee.";

      const list = document.getElementById("analysisList");
      list.textContent = "";

      const diagnostics = Array.isArray(analysis.diagnostics) ? analysis.diagnostics : [];

      if (diagnostics.length === 0) {
        const empty = document.createElement("div");
        empty.className = "analysis-entry";
        empty.textContent = "Aucune sortie analysee pour le moment.";
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

    window.addEventListener("message", (event) => {
      const msg = event.data;

      if (msg.type === "output") {
        appendLines(msg.lines, msg.kind);
      }

      if (msg.type === "clearOutput") {
        document.getElementById("output").textContent = "QC1 pret.";
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
