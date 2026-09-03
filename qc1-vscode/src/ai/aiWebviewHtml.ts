/**
 * RÉSUMÉ — DOCUMENT HTML DE LA WEBVIEW LIIX AI
 *
 * Ce fichier contient uniquement l'interface du produit: rail, conversation,
 * composer, outils inline, permissions, Tasks, Terminal et Settings. Le script
 * n'exécute aucune action système; il échange des messages structurés avec
 * LiixAiPanelProvider. Toutes les valeurs dynamiques passent par textContent ou
 * une fonction d'échappement pour éviter le XSS.
 */

export interface LiixWebviewBootstrap {
  nonce: string;
  provider: string;
  model: string;
  workspace: string;
  localApiUrl: string;
  localApiType: string;
  toolCallingMode: string;
}

export function getLiixWebviewHtml(bootstrap: LiixWebviewBootstrap): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${bootstrap.nonce}'; script-src 'nonce-${bootstrap.nonce}';">
  <style nonce="${bootstrap.nonce}">
    :root {
      --bg:#0a0a0c;--bg2:#0d0e11;--surface:#121317;--surface2:#16171b;--surface3:#1a1b20;
      --text:#e8e8ea;--muted:#92949b;--line:rgba(255,255,255,.075);--accent:#ff3b53;
      --accent2:#ff596c;--success:#4fd18b;--warning:#d8a84e;--danger:#ff596c;--blue:#76a9ff;
      --font:var(--vscode-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
      --mono:var(--vscode-editor-font-family,"SFMono-Regular",Consolas,monospace);
    }
    *{box-sizing:border-box}html,body{height:100%;overflow:hidden}body{margin:0;background:var(--bg);color:var(--text);font:12px/1.5 var(--font)}
    button,input,textarea,select{font:inherit;color:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.hidden{display:none!important}
    :focus-visible{outline:2px solid var(--accent);outline-offset:2px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
    .app{height:100vh;display:grid;grid-template-columns:42px minmax(0,1fr);min-width:0;background:linear-gradient(180deg,var(--bg2),var(--bg))}
    .rail{border-right:1px solid var(--line);background:#0b0c0f;display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 4px}
    .brand{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--accent);font-weight:850;color:#fff;margin-bottom:8px;box-shadow:0 0 18px rgba(255,59,83,.16)}
    .nav{width:34px;height:34px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--muted);display:grid;place-items:center;position:relative}
    .nav svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7}.nav:hover{background:var(--surface2);color:var(--text)}.nav.active{background:var(--surface3);color:var(--text)}
    .nav.active::before{content:"";position:absolute;left:-4px;width:2px;height:18px;border-radius:2px;background:var(--accent)}.rail-spacer{flex:1}
    .shell{height:100vh;min-width:0;display:grid;grid-template-rows:48px minmax(0,1fr) 24px}.topbar{border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 14px;background:rgba(13,14,17,.94)}
    .wordmark{font-weight:800;font-size:14px;letter-spacing:-.01em}.top-actions{display:flex;align-items:center;gap:7px;min-width:0}.model-select{max-width:210px;min-width:80px;height:29px;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:0 25px 0 8px;text-overflow:ellipsis}
    .connection{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:10px;white-space:nowrap}.dot{width:7px;height:7px;border-radius:50%;background:var(--muted)}.dot.connected{background:var(--success);box-shadow:0 0 8px rgba(79,209,139,.4)}.dot.busy{background:var(--accent);animation:pulse 1.2s infinite}.dot.error{background:var(--danger)}
    .icon-button{width:29px;height:29px;border:1px solid var(--line);border-radius:8px;background:transparent;display:grid;place-items:center}.icon-button:hover{background:var(--surface2)}
    main{min-height:0;overflow:hidden}.page{display:none;height:100%;min-width:0}.page.active{display:block}.chat-page.active{display:grid;grid-template-rows:minmax(0,1fr) auto;max-width:860px;margin:0 auto}
    .conversation{position:relative;overflow-y:auto;overflow-x:hidden;padding:22px clamp(12px,4vw,34px) 14px;scrollbar-width:thin}.messages{display:flex;flex-direction:column;gap:18px;min-height:100%}
    .welcome{margin:auto;max-width:520px;text-align:center;padding:32px 0}.welcome-logo{width:44px;height:44px;margin:0 auto 16px;border-radius:13px;background:linear-gradient(145deg,var(--accent2),var(--accent));display:grid;place-items:center;font-weight:900;font-size:20px;box-shadow:0 12px 35px rgba(255,59,83,.18)}
    .welcome h1{font-size:22px;letter-spacing:-.025em;margin:0 0 7px}.welcome p{color:var(--muted);margin:0 0 22px}.suggestions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.suggestion{text-align:left;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--text)}.suggestion:hover{border-color:rgba(255,89,108,.4);background:var(--surface2)}
    .message{max-width:100%;word-break:break-word;animation:enter .16s ease}.message.user{align-self:flex-end;max-width:min(88%,560px);padding:9px 12px;border-radius:14px 14px 4px 14px;background:var(--surface3);border:1px solid var(--line)}
    .assistant-head{display:flex;align-items:center;gap:7px;margin-bottom:7px;font-size:11px;font-weight:700}.assistant-mark{width:20px;height:20px;border-radius:6px;background:var(--accent);display:grid;place-items:center;color:#fff;font-size:10px}.assistant-body{font-size:13px;line-height:1.62}.assistant-body p{margin:0 0 10px}.assistant-body p:last-child{margin-bottom:0}.assistant-body h1,.assistant-body h2,.assistant-body h3{margin:15px 0 7px;line-height:1.25}.assistant-body h1{font-size:18px}.assistant-body h2{font-size:15px}.assistant-body h3{font-size:13px}.assistant-body ul,.assistant-body ol{margin:7px 0;padding-left:22px}.assistant-body blockquote{margin:8px 0;padding-left:10px;border-left:2px solid var(--accent);color:var(--muted)}
    code{font:11px/1.5 var(--mono);background:var(--surface3);border-radius:4px;padding:1px 4px}.code-block{margin:10px 0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#07080a}.code-head{height:30px;display:flex;align-items:center;justify-content:space-between;padding:0 9px;border-bottom:1px solid var(--line);color:var(--muted);font-size:10px}.copy-code{border:0;background:transparent;color:var(--muted);padding:3px 6px}.copy-code:hover{color:var(--text)}pre{margin:0;padding:11px;overflow:auto;font:11px/1.55 var(--mono);white-space:pre}.inline-link{color:var(--blue)}
    .activity{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:12px;padding:2px 0}.ai-ring{position:relative;width:18px;height:18px;flex:0 0 auto;border-radius:50%;background:conic-gradient(from 0deg,transparent 0 18%,var(--accent) 35%,var(--accent2) 68%,transparent 82%);animation:spin .85s linear infinite;box-shadow:0 0 12px rgba(255,59,83,.2)}.ai-ring::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--bg)}.activity.permission .ai-ring{background:conic-gradient(transparent,var(--warning));box-shadow:0 0 12px rgba(216,168,78,.2)}
    .tool-card{border-left:1px solid var(--line);margin-left:8px;padding:2px 0 2px 13px}.tool-card summary{list-style:none;display:grid;grid-template-columns:18px minmax(0,1fr) auto;align-items:center;gap:7px;cursor:pointer;min-height:28px}.tool-card summary::-webkit-details-marker{display:none}.tool-icon{width:16px;height:16px;display:grid;place-items:center;color:var(--muted);font-size:11px}.tool-card.running .tool-icon{font-size:0}.tool-card.running .tool-icon::after{content:"";width:12px;height:12px;border-radius:50%;background:conic-gradient(transparent,var(--accent));animation:spin .9s linear infinite}.tool-card.success .tool-icon{color:var(--success)}.tool-card.error .tool-icon{color:var(--danger)}.tool-name{font-weight:650}.tool-summary{display:block;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tool-meta{color:var(--muted);font-size:10px;white-space:nowrap}.tool-output{margin:7px 0 5px;padding:9px;border-radius:8px;background:#07080a;border:1px solid var(--line);max-height:240px;overflow:auto;white-space:pre-wrap;font:10px/1.5 var(--mono);color:#c7c9cf}.tool-actions{display:flex;gap:6px;margin-top:6px}.tiny{border:1px solid var(--line);border-radius:6px;background:transparent;padding:3px 7px;color:var(--muted)}
    .permission-card{border:1px solid rgba(216,168,78,.35);border-radius:11px;background:rgba(216,168,78,.06);padding:11px}.permission-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:700}.risk{color:var(--warning);font-size:10px}.permission-detail{margin:7px 0;color:var(--muted);font:11px/1.5 var(--mono);white-space:pre-wrap}.permission-buttons{display:flex;flex-wrap:wrap;gap:6px}.permission-buttons button{border:1px solid var(--line);border-radius:7px;background:var(--surface2);padding:5px 8px}.permission-buttons .allow{background:var(--warning);color:#17120a;border-color:transparent}.permission-buttons .deny{color:var(--danger)}
    .new-messages{position:sticky;bottom:8px;margin:0 auto;display:block;border:1px solid var(--line);border-radius:999px;background:var(--surface3);padding:5px 10px;box-shadow:0 8px 24px #000;color:var(--text)}
    .composer-wrap{padding:8px clamp(10px,3vw,28px) 12px;background:linear-gradient(transparent,var(--bg) 18%)}.context-chips{display:flex;gap:5px;overflow-x:auto;margin-bottom:5px}.chip{display:flex;align-items:center;gap:5px;max-width:190px;border:1px solid var(--line);border-radius:999px;background:var(--surface);padding:3px 7px;color:var(--muted);font-size:10px;white-space:nowrap}.chip span{overflow:hidden;text-overflow:ellipsis}.chip button{border:0;background:transparent;color:var(--muted);padding:0}
    .composer{position:relative;border:1px solid rgba(255,255,255,.11);border-radius:15px;background:var(--surface);box-shadow:0 14px 36px rgba(0,0,0,.25);padding:10px;transition:border-color .15s}.composer:focus-within{border-color:rgba(255,59,83,.55)}textarea{display:block;width:100%;min-height:50px;max-height:170px;resize:none;border:0;outline:0;background:transparent;color:var(--text);padding:0 2px;font:13px/1.5 var(--font)}textarea::placeholder{color:#73757d}.composer-bar{display:flex;align-items:center;gap:6px;margin-top:8px}.composer-spacer{flex:1}.round{width:28px;height:28px;border:1px solid var(--line);border-radius:8px;background:transparent;display:grid;place-items:center}.send{width:29px;height:29px;border:0;border-radius:9px;background:var(--accent);color:#fff;font-size:16px;display:grid;place-items:center}.send:hover{background:var(--accent2)}.mode-select{height:28px;border:1px solid var(--line);border-radius:8px;background:var(--surface2);padding:0 7px}.context-menu{position:absolute;left:9px;bottom:45px;width:190px;padding:5px;border:1px solid var(--line);border-radius:10px;background:var(--surface3);box-shadow:0 16px 40px #000;z-index:5}.context-menu button{display:block;width:100%;text-align:left;border:0;border-radius:7px;background:transparent;padding:7px 8px;color:var(--text)}.context-menu button:hover{background:rgba(255,255,255,.06)}.queue{color:var(--muted);font-size:10px;white-space:nowrap}
    .section-page{overflow:auto;padding:18px;max-width:860px;margin:0 auto}.section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:18px}.section-head h1{font-size:18px;margin:0}.subtle{color:var(--muted)}.task-current{border-bottom:1px solid var(--line);padding-bottom:15px;margin-bottom:15px}.task-title{font-size:14px;font-weight:700}.task-stats{display:flex;flex-wrap:wrap;gap:12px;color:var(--muted);font-size:11px;margin-top:6px}.task-list{display:grid;gap:8px}.task-row{padding:9px 0;border-bottom:1px solid var(--line)}
    .terminal-page{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:10px;padding:14px}.terminal-output{overflow:auto;border:1px solid var(--line);border-radius:10px;background:#07080a;padding:10px;font:11px/1.55 var(--mono);white-space:pre-wrap}.term-command{color:#ffb5bf;margin-top:8px}.term-stdout{color:#d5d7dc}.term-stderr{color:var(--danger)}.terminal-input{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}.terminal-input input,.settings input,.settings select{min-width:0;height:32px;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:0 9px}.terminal-input button,.settings button,.head-button{border:1px solid var(--line);border-radius:8px;background:var(--surface2);padding:6px 9px}
    .settings{display:grid;grid-template-columns:130px minmax(0,1fr);gap:18px}.settings-nav{display:grid;align-content:start;gap:3px;position:sticky;top:0}.settings-nav button{border:0;border-radius:7px;background:transparent;color:var(--muted);padding:7px;text-align:left}.settings-nav button.active{background:var(--surface2);color:var(--text)}.settings-panel{display:none}.settings-panel.active{display:block}.settings-group{padding-bottom:18px;margin-bottom:18px;border-bottom:1px solid var(--line)}.settings-group h2{font-size:13px;margin:0 0 11px}.field{display:grid;gap:5px;margin-bottom:10px}.field label{color:var(--muted);font-size:11px}.connection-result{margin-top:9px;padding:8px;border-radius:8px;background:var(--surface);color:var(--muted)}
    .statusbar{border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 10px;color:var(--muted);font-size:9px;white-space:nowrap;overflow:hidden}.statusbar span{overflow:hidden;text-overflow:ellipsis}
    @keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{50%{opacity:.45}}@keyframes enter{from{opacity:0;transform:translateY(4px)}}
    @media(max-width:500px){.topbar{padding:0 9px}.wordmark{font-size:13px}.model-select{max-width:140px}.connection span{display:none}.conversation{padding:16px 11px 10px}.composer-wrap{padding:7px 8px 9px}.suggestions{grid-template-columns:1fr}.settings{grid-template-columns:1fr}.settings-nav{display:flex;overflow:auto;position:static}.section-page{padding:13px}.tool-card{margin-left:3px;padding-left:9px}.tool-meta{display:none}}
    @media(max-width:320px){.app{grid-template-columns:38px minmax(0,1fr)}.rail{padding-inline:2px}.nav{width:30px}.brand{width:27px}.topbar{padding-inline:7px}.model-select{max-width:110px}.queue{display:none}.message.user{max-width:94%}}
  </style>
</head>
<body>
  <div class="app">
    <aside class="rail" aria-label="Navigation Liix">
      <div class="brand" title="Liix AI">L</div>
      ${navButton("chat", "Chat", "M4 4h16v12H8l-4 4V4z", true)}
      ${navButton("tasks", "Tasks et activité", "M7 4h10v3H7zM5 9h14v11H5z")}
      ${navButton("terminal", "Terminal", "M5 6l5 5-5 5m7 0h7")}
      <div class="rail-spacer"></div>
      ${navButton("settings", "Réglages", "M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5zM12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4")}
    </aside>
    <div class="shell">
      <header class="topbar">
        <span class="wordmark">Liix</span>
        <div class="top-actions">
          <select id="modelSelect" class="model-select" aria-label="Modèle actif"><option value="${escapeHtml(bootstrap.model)}">${escapeHtml(bootstrap.model || "Choisir un modèle")}</option></select>
          <div class="connection" title="État du runtime local"><span id="connectionDot" class="dot"></span><span id="connectionLabel">inspection</span></div>
          <button id="newChat" class="icon-button" title="Nouvelle conversation" aria-label="Nouvelle conversation">＋</button>
        </div>
      </header>
      <main>
        <section id="page-chat" class="page chat-page active">
          <div id="conversation" class="conversation" aria-live="polite">
            <div id="messages" class="messages">
              <div id="welcome" class="welcome">
                <div class="welcome-logo">L</div><h1>Que veux-tu construire ?</h1><p>Liix peut comprendre, inspecter, modifier et vérifier ton projet.</p>
                <div class="suggestions">
                  <button class="suggestion" data-prompt="Explique-moi l'architecture de ce projet.">Explique ce projet</button>
                  <button class="suggestion" data-prompt="Trouve et corrige les erreurs de compilation de ce projet.">Corrige les erreurs</button>
                  <button class="suggestion" data-prompt="Analyse le fichier actif et propose des améliorations concrètes.">Améliore ce code</button>
                  <button class="suggestion" data-prompt="Lance les tests, analyse les échecs et corrige ce qui est nécessaire.">Lance les tests</button>
                </div>
              </div>
            </div>
            <button id="newMessages" class="new-messages hidden">↓ Nouveaux messages</button>
          </div>
          <div class="composer-wrap">
            <div id="contextChips" class="context-chips"></div>
            <div class="composer">
              <textarea id="prompt" rows="2" aria-label="Message à Liix" placeholder="Demande quelque chose à Liix..."></textarea>
              <div id="contextMenu" class="context-menu hidden">
                <button data-context="activeFile">Fichier actif</button><button data-context="selection">Sélection</button>
                <button data-context="file">Fichier...</button><button data-context="folder">Dossier...</button>
                <button data-context="diagnostics">Diagnostics</button><button data-context="terminal">Dernier terminal</button><button data-context="gitDiff">Git diff</button>
              </div>
              <div class="composer-bar">
                <button id="contextButton" class="round" title="Ajouter du contexte" aria-label="Ajouter du contexte">＋</button>
                <select id="modeSelect" class="mode-select" aria-label="Mode Liix"><option value="chat">Chat</option><option value="agent">Agent</option><option value="full">Full</option></select>
                <span id="queueLabel" class="queue">Prêt</span><span class="composer-spacer"></span>
                <button id="stopButton" class="round hidden" title="Arrêter réellement la tâche" aria-label="Arrêter">■</button>
                <button id="sendButton" class="send" title="Envoyer (Entrée)" aria-label="Envoyer">↑</button>
              </div>
            </div>
          </div>
        </section>
        <section id="page-tasks" class="page section-page">
          <div class="section-head"><div><h1>Tasks</h1><div class="subtle">Activité agentique réelle</div></div><button id="openDiff" class="head-button">Voir le dernier diff</button></div>
          <div id="currentTask" class="task-current"><div class="subtle">Aucune tâche active.</div></div>
          <div id="taskHistory" class="task-list"></div>
        </section>
        <section id="page-terminal" class="page terminal-page">
          <div class="section-head"><div><h1>Terminal</h1><div class="subtle"><span id="terminalDot" class="dot"></span> <span id="terminalState">idle</span></div></div><button id="clearTerminal" class="head-button">Clear</button></div>
          <div id="terminalOutput" class="terminal-output" aria-live="polite"><div class="term-stdout">Terminal Liix prêt.</div></div>
          <div class="terminal-input"><input id="terminalInput" aria-label="Commande terminal" placeholder="cmake --build build/qc1"><button id="terminalRun">Run</button></div>
        </section>
        <section id="page-settings" class="page section-page">
          <div class="section-head"><div><h1>Settings</h1><div class="subtle">Runtime local et sécurité</div></div></div>
          <div class="settings">
            <nav class="settings-nav"><button class="active" data-setting="general">General</button><button data-setting="models">Models</button><button data-setting="runtime">Local Runtime</button><button data-setting="agent">Agent</button><button data-setting="permissions">Permissions</button><button data-setting="context">Context</button><button data-setting="appearance">Appearance</button></nav>
            <div>
              <div id="setting-general" class="settings-panel active"><div class="settings-group"><h2>General</h2><p class="subtle">Liix utilise le workspace VS Code actif et ne fait aucun commit automatiquement.</p><button id="undoEdit">Undo last Liix edit</button></div></div>
              <div id="setting-models" class="settings-panel"><div class="settings-group"><h2>Models</h2><div class="field"><label>Modèle actif</label><select id="settingsModel"><option>${escapeHtml(bootstrap.model)}</option></select></div><button id="refreshModels">Refresh local models</button></div></div>
              <div id="setting-runtime" class="settings-panel"><div class="settings-group"><h2>Local Runtime</h2><div class="field"><label>Provider</label><select id="provider"><option value="local">Local / LM Studio</option><option value="liix">Liix Cloud</option></select></div><div class="field"><label>API Type</label><select id="apiType"><option value="openai-compatible">OpenAI Compatible</option><option value="ollama">Ollama</option></select></div><div class="field"><label>Endpoint</label><input id="endpoint" value="${escapeHtml(bootstrap.localApiUrl)}"></div><div class="field"><label>Tool calling</label><select id="toolCalling"><option value="auto">Auto</option><option value="native">Native</option><option value="fallback">Fallback structuré</option></select></div><button id="saveRuntime">Enregistrer</button> <button id="testConnection">Test Connection</button><div id="connectionResult" class="connection-result">Non testé.</div></div></div>
              <div id="setting-agent" class="settings-panel"><div class="settings-group"><h2>Agent</h2><p class="subtle">Maximum 20 étapes par défaut. Stop annule fetch, boucle et processus enfant.</p></div></div>
              <div id="setting-permissions" class="settings-panel"><div class="settings-group"><h2>Permissions</h2><p class="subtle">Chat: lecture seulement.<br>Agent: écritures et commandes avec confirmation.<br>Full: opérations sûres automatiques; risque élevé toujours confirmé.</p></div></div>
              <div id="setting-context" class="settings-panel"><div class="settings-group"><h2>Context</h2><p class="subtle">Le contexte est demandé progressivement avec les outils. Les gros résultats sont tronqués et l'historique récent est prioritaire.</p></div></div>
              <div id="setting-appearance" class="settings-panel"><div class="settings-group"><h2>Appearance</h2><p class="subtle">Thème Liix sombre, animations réduites automatiquement selon le système.</p></div></div>
            </div>
          </div>
        </section>
      </main>
      <footer class="statusbar"><span id="runtimeLine">${escapeHtml(bootstrap.workspace)} · ${escapeHtml(bootstrap.provider)}</span><span id="usageLine">usage: --</span></footer>
    </div>
  </div>
  <script nonce="${bootstrap.nonce}">
    const vscode = acquireVsCodeApi();
    const saved = vscode.getState() || {};
    const byId = (id) => document.getElementById(id);
    let mode = saved.mode || "chat";
    let currentPage = saved.page || "chat";
    let queue = [];
    let busy = false;
    let activeRequestId = "";
    let attachments = [];
    let terminalHistory = [];
    let terminalHistoryIndex = 0;
    const streamNodes = new Map();
    const toolNodes = new Map();
    let activityNode = null;

    function persist() {
      vscode.setState({ page: currentPage, mode, draft: byId("prompt").value });
    }

    function showPage(page) {
      currentPage = page;
      document.querySelectorAll(".page").forEach((node) => node.classList.toggle("active", node.id === "page-" + page));
      document.querySelectorAll(".nav").forEach((node) => node.classList.toggle("active", node.dataset.page === page));
      persist();
    }

    document.querySelectorAll(".nav").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
    document.querySelectorAll(".settings-nav button").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll(".settings-nav button").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll(".settings-panel").forEach((item) => item.classList.toggle("active", item.id === "setting-" + button.dataset.setting));
    }));
    showPage(currentPage);
    byId("modeSelect").value = mode;
    byId("prompt").value = saved.draft || "";
    byId("modeSelect").addEventListener("change", () => { mode = byId("modeSelect").value; persist(); });
    byId("prompt").addEventListener("input", persist);
    byId("prompt").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); enqueuePrompt(); }
    });
    byId("sendButton").addEventListener("click", enqueuePrompt);
    byId("stopButton").addEventListener("click", () => activeRequestId && vscode.postMessage({ type: "cancel", requestId: activeRequestId }));
    byId("newChat").addEventListener("click", () => vscode.postMessage({ type: "newChat" }));
    byId("openDiff").addEventListener("click", () => vscode.postMessage({ type: "openLastDiff" }));
    byId("undoEdit").addEventListener("click", () => vscode.postMessage({ type: "undoLastEdit" }));
    byId("modelSelect").addEventListener("change", () => vscode.postMessage({ type: "selectModel", modelId: byId("modelSelect").value }));
    byId("settingsModel").addEventListener("change", () => vscode.postMessage({ type: "selectModel", modelId: byId("settingsModel").value }));
    byId("refreshModels").addEventListener("click", () => vscode.postMessage({ type: "refreshModels" }));
    byId("testConnection").addEventListener("click", () => { byId("connectionResult").textContent = "Connexion en cours..."; vscode.postMessage({ type: "testConnection" }); });
    byId("saveRuntime").addEventListener("click", () => vscode.postMessage({ type: "settingsChanged", provider: byId("provider").value, localApiType: byId("apiType").value, localApiUrl: byId("endpoint").value, localModel: byId("settingsModel").value, toolCallingMode: byId("toolCalling").value }));

    document.querySelectorAll(".suggestion").forEach((button) => button.addEventListener("click", () => { byId("prompt").value = button.dataset.prompt; enqueuePrompt(); }));
    byId("contextButton").addEventListener("click", () => byId("contextMenu").classList.toggle("hidden"));
    document.querySelectorAll("[data-context]").forEach((button) => button.addEventListener("click", () => { byId("contextMenu").classList.add("hidden"); vscode.postMessage({ type: "contextRequest", contextType: button.dataset.context }); }));
    byId("newMessages").addEventListener("click", () => { scrollBottom(); byId("newMessages").classList.add("hidden"); });

    byId("terminalRun").addEventListener("click", runTerminal);
    byId("terminalInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") runTerminal();
      if (event.key === "ArrowUp" && terminalHistory.length) { event.preventDefault(); terminalHistoryIndex = Math.max(0, terminalHistoryIndex - 1); byId("terminalInput").value = terminalHistory[terminalHistoryIndex] || ""; }
      if (event.key === "ArrowDown" && terminalHistory.length) { event.preventDefault(); terminalHistoryIndex = Math.min(terminalHistory.length, terminalHistoryIndex + 1); byId("terminalInput").value = terminalHistory[terminalHistoryIndex] || ""; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") { event.preventDefault(); clearTerminal(); }
    });
    byId("clearTerminal").addEventListener("click", clearTerminal);

    function enqueuePrompt() {
      const text = byId("prompt").value.trim();
      if (!text) return;
      byId("prompt").value = "";
      persist();
      queue.push({ text, requestId: makeId(), mode, modelId: byId("modelSelect").value, contexts: attachments.slice() });
      attachments = [];
      renderAttachments();
      updateQueue();
      dispatch();
    }

    function dispatch() {
      if (busy || !queue.length) return;
      const item = queue.shift();
      busy = true;
      activeRequestId = item.requestId;
      setBusy(true);
      appendUser(item.text);
      hideWelcome();
      updateQueue();
      vscode.postMessage({ type: "sendMessage", requestId: item.requestId, message: item.text, mode: item.mode, modelId: item.modelId, contexts: item.contexts });
    }

    function runTerminal() {
      const command = byId("terminalInput").value.trim();
      if (!command || busy) return;
      terminalHistory.push(command); terminalHistoryIndex = terminalHistory.length; byId("terminalInput").value = "";
      busy = true; activeRequestId = makeId(); setBusy(true); appendTerminal("$ " + command, "command");
      vscode.postMessage({ type: "runTerminal", requestId: activeRequestId, command, mode: "full" });
    }

    function clearTerminal() { byId("terminalOutput").textContent = ""; }
    function updateQueue() { byId("queueLabel").textContent = queue.length ? "Queued " + queue.length : busy ? "En cours" : "Prêt"; }
    function setBusy(value) { busy = value; byId("stopButton").classList.toggle("hidden", !value); byId("sendButton").disabled = false; byId("terminalDot").classList.toggle("busy", value); byId("terminalState").textContent = value ? "running" : "idle"; }
    function hideWelcome() { byId("welcome")?.classList.add("hidden"); }

    function appendUser(text) {
      const node = document.createElement("div"); node.className = "message user"; node.textContent = text; appendNode(node);
    }

    function startAssistant(turnId) {
      removeActivity(); hideWelcome();
      let body = streamNodes.get(turnId);
      if (body) return body;
      const node = document.createElement("div"); node.className = "message assistant";
      node.innerHTML = '<div class="assistant-head"><span class="assistant-mark">L</span>Liix</div><div class="assistant-body"></div>';
      body = node.querySelector(".assistant-body"); streamNodes.set(turnId, body); appendNode(node); return body;
    }

    function appendDelta(turnId, content) { const body = startAssistant(turnId); body.textContent += content; maybeScroll(); }
    function finishAssistant(turnId, content) { const body = startAssistant(turnId); if(!content){body.closest(".message").remove();streamNodes.delete(turnId);return;} body.innerHTML = renderMarkdown(content); wireCopyButtons(body); maybeScroll(); }

    function showActivity(label, state) {
      removeActivity();
      const node = document.createElement("div"); node.className = "activity" + (state === "waiting_permission" ? " permission" : "");
      node.innerHTML = '<span class="ai-ring"></span><span></span>'; node.lastElementChild.textContent = label; activityNode = node; appendNode(node);
    }
    function removeActivity() { if (activityNode) activityNode.remove(); activityNode = null; }

    function updateTool(event) {
      if ((event.stdout || event.stderr) && toolNodes.has(event.toolCallId)) {
        const output = toolNodes.get(event.toolCallId).querySelector(".tool-output"); output.textContent += event.stdout || event.stderr || ""; maybeScroll(); return;
      }
      let node = toolNodes.get(event.toolCallId);
      if (!node) {
        node = document.createElement("details"); node.className = "tool-card running";
        node.innerHTML = '<summary><span class="tool-icon">○</span><span><span class="tool-name"></span><span class="tool-summary"></span></span><span class="tool-meta"></span></summary><pre class="tool-output"></pre><div class="tool-actions hidden"><button class="tiny view-diff">View diff</button><button class="tiny undo-tool">Undo</button></div>';
        node.querySelector(".tool-name").textContent = humanTool(event.name); toolNodes.set(event.toolCallId, node); appendNode(node);
        node.querySelector(".view-diff").addEventListener("click", () => vscode.postMessage({ type: "openLastDiff" }));
        node.querySelector(".undo-tool").addEventListener("click", () => vscode.postMessage({ type: "undoLastEdit" }));
      }
      node.className = "tool-card " + event.state;
      node.querySelector(".tool-icon").textContent = event.state === "success" ? "✓" : event.state === "error" ? "!" : "";
      node.querySelector(".tool-summary").textContent = event.summary || "";
      node.querySelector(".tool-meta").textContent = [event.exitCode === undefined ? "" : "Exit " + event.exitCode, event.durationMs === undefined ? "" : formatDuration(event.durationMs)].filter(Boolean).join(" · ");
      const output = [event.stdout, event.stderr].filter(Boolean).join("\\n"); if (output) node.querySelector(".tool-output").textContent = output;
      const actions = node.querySelector(".tool-actions"); actions.classList.toggle("hidden", !(event.affectedFiles && event.affectedFiles.length)); maybeScroll();
    }

    function showPermission(request) {
      removeActivity();
      const node = document.createElement("div"); node.className = "permission-card";
      node.innerHTML = '<div class="permission-title"><span>Liix demande une permission</span><span class="risk"></span></div><div class="permission-detail"></div><div class="permission-buttons"><button class="allow" data-decision="allowOnce">Autoriser</button><button data-decision="allowSession">Toujours pour cette session</button><button class="deny" data-decision="deny">Refuser</button></div>';
      node.querySelector(".risk").textContent = "Risque " + request.risk;
      node.querySelector(".permission-detail").textContent = request.command ? "$ " + request.command : request.files?.length ? request.files.join("\\n") : request.action;
      node.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { node.remove(); vscode.postMessage({ type: "permissionDecision", permissionId: request.id, decision: button.dataset.decision }); }));
      appendNode(node);
    }

    function appendTerminal(content, stream) { const node = document.createElement("div"); node.className = stream === "stderr" ? "term-stderr" : stream === "command" ? "term-command" : "term-stdout"; node.textContent = content; byId("terminalOutput").appendChild(node); byId("terminalOutput").scrollTop = byId("terminalOutput").scrollHeight; }

    function renderTask(task) {
      byId("currentTask").innerHTML = '<div class="task-title"></div><div class="task-stats"></div>';
      byId("currentTask").querySelector(".task-title").textContent = task.title;
      const stats = [task.state + " · " + formatDuration(task.durationMs), task.steps + " étapes", task.toolCalls + " outils", task.terminalCommands + " commandes", task.modifiedFiles.length + " fichiers modifiés"];
      stats.forEach((text) => { const span = document.createElement("span"); span.textContent = text; byId("currentTask").querySelector(".task-stats").appendChild(span); });
      if(task.state!=="running"&&!byId("taskHistory").querySelector('[data-task="'+task.startedAt+'"]')){const row=document.createElement("div");row.className="task-row";row.dataset.task=String(task.startedAt);row.textContent=task.title+" · "+task.state+" · "+formatDuration(task.durationMs);byId("taskHistory").prepend(row);}
    }

    function renderRuntime(runtime) {
      syncModels(runtime.models || [], runtime.activeModel || runtime.localModel || "");
      byId("provider").value = runtime.activeProvider || "local"; byId("apiType").value = runtime.localApiType || "openai-compatible";
      byId("endpoint").value = runtime.localApiUrl || ""; byId("toolCalling").value = runtime.toolCallingMode || "auto";
      byId("runtimeLine").textContent = (runtime.workspace || "--") + " · " + (runtime.activeEndpoint || "--");
      byId("connectionLabel").textContent = runtime.connected ? "local" : runtime.localMode ? "offline" : "cloud";
      byId("connectionDot").className = "dot " + (runtime.connected || !runtime.localMode ? "connected" : "");
    }

    function syncModels(models, active) {
      [byId("modelSelect"), byId("settingsModel")].forEach((select) => { select.textContent = ""; (models.length ? models : [{ id: active, label: active || "Aucun modèle" }]).forEach((model) => { const option = document.createElement("option"); option.value = model.id; option.textContent = model.label || model.id; select.appendChild(option); }); select.value = active; });
    }

    function addContext(context) { if (!attachments.some((item) => item.id === context.id)) attachments.push(context); renderAttachments(); persist(); }
    function renderAttachments() { const box = byId("contextChips"); box.textContent = ""; attachments.forEach((context) => { const chip = document.createElement("div"); chip.className = "chip"; chip.innerHTML = '<span></span><button aria-label="Retirer">×</button>'; chip.querySelector("span").textContent = context.label; chip.querySelector("button").addEventListener("click", () => { attachments = attachments.filter((item) => item.id !== context.id); renderAttachments(); persist(); }); box.appendChild(chip); }); }
    renderAttachments();

    function appendNode(node) { const shouldScroll = nearBottom(); byId("messages").appendChild(node); if (shouldScroll) scrollBottom(); else byId("newMessages").classList.remove("hidden"); }
    function nearBottom() { const box = byId("conversation"); return box.scrollHeight - box.scrollTop - box.clientHeight < 90; }
    function maybeScroll() { if (nearBottom()) scrollBottom(); else byId("newMessages").classList.remove("hidden"); }
    function scrollBottom() { const box = byId("conversation"); box.scrollTop = box.scrollHeight; }
    function makeId() { return String(Date.now()) + "-" + Math.random().toString(16).slice(2); }
    function humanTool(name) { return ({ read_file:"Read",list_directory:"List",search_files:"Find",search_text:"Search",get_active_file:"Active file",get_selection:"Selection",get_diagnostics:"Diagnostics",inspect_project:"Inspect",write_file:"Write",create_file:"Create",apply_patch:"Edit",delete_file:"Delete",run_terminal:"Run",build_project:"Build",run_tests:"Tests",git_status:"Git status",git_diff:"Git diff",git_log:"Git log",git_show:"Git show" })[name] || name; }
    function formatDuration(ms) { return ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(1) + " s"; }

    function renderMarkdown(text) {
      const fence = String.fromCharCode(96,96,96); const parts = String(text).split(fence);
      return parts.map((part,index) => {
        if(index%2){ const lines=part.replace(/^\\n/,"").split("\\n"); const lang=/^[\\w+#.-]+$/.test(lines[0]||"")?lines.shift():"code"; return '<div class="code-block"><div class="code-head"><span>'+escapeHtml(lang)+'</span><button class="copy-code">Copy</button></div><pre><code>'+escapeHtml(lines.join("\\n"))+'</code></pre></div>'; }
        const lines=part.split("\\n"); let html="", list="";
        function closeList(){if(list){html+="</"+list+">";list="";}}
        lines.forEach((line) => { let match;
          if((match=line.match(/^(#{1,3})\\s+(.+)/))){closeList();const level=match[1].length;html+="<h"+level+">"+inline(match[2])+"</h"+level+">";}
          else if((match=line.match(/^[-*]\\s+(.+)/))){if(list!=="ul"){closeList();html+="<ul>";list="ul";}html+="<li>"+inline(match[1])+"</li>";}
          else if((match=line.match(/^\\d+\\.\\s+(.+)/))){if(list!=="ol"){closeList();html+="<ol>";list="ol";}html+="<li>"+inline(match[1])+"</li>";}
          else if(line.startsWith("> ")){closeList();html+="<blockquote>"+inline(line.slice(2))+"</blockquote>";}
          else if(line.trim()){closeList();html+="<p>"+inline(line)+"</p>";} else closeList();
        }); closeList(); return html;
      }).join("");
    }
    function inline(value) { const tick=String.fromCharCode(96); return escapeHtml(value).replace(new RegExp(tick+"([^"+tick+"]+)"+tick,"g"),"<code>$1</code>").replace(/\\*\\*([^*]+)\\*\\*/g,"<strong>$1</strong>"); }
    function escapeHtml(value) { return String(value).replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]); }
    function wireCopyButtons(root) { root.querySelectorAll(".copy-code").forEach((button) => button.addEventListener("click", () => vscode.postMessage({ type:"copyText", content:button.closest(".code-block").querySelector("code").textContent }))); }

    window.addEventListener("message", (event) => {
      const msg=event.data;
      if(msg.type==="navigate") showPage(msg.page);
      if(msg.type==="externalPrompt"){ showPage("chat"); mode=msg.mode||"agent"; byId("modeSelect").value=mode; byId("prompt").value=msg.prompt||""; enqueuePrompt(); }
      if(msg.type==="agentStatus"){ byId("connectionDot").className="dot "+(["analyzing","running_tool","streaming","waiting_permission"].includes(msg.state)?"busy":msg.state==="error"?"error":"connected"); if(["analyzing","reading_context","running_tool","waiting_permission"].includes(msg.state)) showActivity(msg.label,msg.state); }
      if(msg.type==="assistantStart") startAssistant(msg.turnId);
      if(msg.type==="assistantDelta") appendDelta(msg.turnId,msg.content);
      if(msg.type==="assistantFinal") finishAssistant(msg.turnId,msg.content);
      if(msg.type==="toolEvent") { removeActivity(); updateTool(msg.event); if(msg.event.stdout) appendTerminal(msg.event.stdout,"stdout"); if(msg.event.stderr) appendTerminal(msg.event.stderr,"stderr"); }
      if(msg.type==="permissionRequest") showPermission(msg.request);
      if(msg.type==="task") renderTask(msg.task);
      if(msg.type==="runtime") renderRuntime(msg.runtime);
      if(msg.type==="connectionTest"){ const result=msg.result; byId("connectionResult").textContent=result.connected?"● Connected · "+result.models.length+" modèle(s) · "+result.latencyMs+" ms":"Erreur · "+result.error; byId("connectionDot").className="dot "+(result.connected?"connected":"error"); }
      if(msg.type==="contextAdded") addContext(msg.context);
      if(msg.type==="terminalEvent") appendTerminal(msg.content,msg.stream);
      if(msg.type==="usage"){ const u=msg.usage||{}; const speed=u.completionTokens&&msg.latencyMs?((u.completionTokens/(msg.latencyMs/1000)).toFixed(1)+" tok/s"):""; byId("usageLine").textContent=[u.totalTokens===undefined?"":u.totalTokens+" tokens",msg.latencyMs===undefined?"":formatDuration(msg.latencyMs),speed].filter(Boolean).join(" · ")||"usage non fourni"; }
      if(msg.type==="toast") { const node=document.createElement("div");node.className="activity";node.textContent=msg.content;appendNode(node);setTimeout(()=>node.remove(),2500); }
      if(msg.type==="errorMessage"){ removeActivity(); const node=document.createElement("div");node.className="message assistant";node.innerHTML='<div class="assistant-head"><span class="assistant-mark">!</span>Liix</div><div class="assistant-body"></div>';node.querySelector(".assistant-body").textContent=msg.content;appendNode(node); }
      if(msg.type==="requestDone"){ removeActivity(); busy=false;activeRequestId="";setBusy(false);updateQueue();dispatch(); }
      if(msg.type==="newChat"){ queue=[];attachments=[];streamNodes.clear();toolNodes.clear();removeActivity();byId("messages").textContent=""; const welcome=document.createElement("div");welcome.id="welcome";welcome.className="welcome";welcome.innerHTML='<div class="welcome-logo">L</div><h1>Nouvelle conversation</h1><p>Que veux-tu construire?</p>';byId("messages").appendChild(welcome);showPage("chat");renderAttachments();updateQueue(); }
    });
  </script>
</body>
</html>`;
}

function navButton(page: string, label: string, pathData: string, active = false): string {
  return `<button class="nav${active ? " active" : ""}" data-page="${page}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${pathData}"/></svg></button>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] || char));
}
