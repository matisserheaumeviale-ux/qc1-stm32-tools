const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

test("runs an LM Studio SSE tool loop and supports real cancellation", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "liix-agent-test-"));
  fs.mkdirSync(path.join(workspace, "src"));
  fs.writeFileSync(path.join(workspace, "src", "main.c"), "int main(void) { return 0; }\n");
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const settings = new Map([
    ["liix.provider", "local"], ["liix.localApiType", "openai-compatible"], ["liix.localModel", "mock-coder"],
    ["liix.supportsToolCalling", "native"], ["liix.aiTimeoutMs", 5_000], ["liix.maxAgentSteps", 5],
    ["liix.maxToolCalls", 8], ["liix.contextBudgetChars", 20_000], ["liix.permissions.files", "ask"],
    ["liix.permissions.terminal", "ask"], ["liix.permissions.git", "ask"]
  ]);
  const vscode = createVscodeMock(workspace, settings);
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    return request === "vscode" ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => { Module._load = originalLoad; });

  let agentTurns = 0;
  let toolResultReinjected = false;
  const server = http.createServer(async (request, response) => {
    if (request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "mock-coder" }] }));
      return;
    }
    if (request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const cancelling = body.messages.some((message) => message.role === "user" && message.content.includes("attends"));
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (cancelling) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Début" } }] })}\n\n`);
      const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 25);
      response.on("close", () => clearInterval(keepAlive));
      return;
    }
    agentTurns += 1;
    toolResultReinjected ||= body.messages.some((message) => message.role === "tool" && message.tool_call_id === "call-read");
    if (agentTurns === 1) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-read", function: { name: "read_", arguments: '{"path":"src/' } }] } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "file", arguments: 'main.c"}' } }] } }] })}\n\n`);
    } else {
      response.write(`data: ${JSON.stringify({ model: "mock-coder", choices: [{ delta: { content: "Fichier lu et vérifié." } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 42, completion_tokens: 9, total_tokens: 51 } })}\n\n`);
    }
    response.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  settings.set("liix.localApiUrl", `http://127.0.0.1:${server.address().port}`);

  const { testLiixConnection } = require("../out/ai/aiClient");
  const { LiixAgentController } = require("../out/ai/aiAgentController");
  const { LiixPermissionManager } = require("../out/ai/aiPermissions");
  const connection = await testLiixConnection();
  assert.equal(connection.connected, true);
  assert.equal(connection.models[0].id, "mock-coder");

  const permissions = new LiixPermissionManager();
  assert.equal(permissions.verdict({ name: "read_file", arguments: { path: "src/main.c" } }, "chat"), "allow");
  assert.equal(permissions.verdict({ name: "write_file", arguments: { path: "src/main.c", content: "x" } }, "chat"), "deny");
  assert.equal(permissions.verdict({ name: "write_file", arguments: { path: "src/main.c", content: "x" } }, "agent"), "ask");
  assert.equal(permissions.verdict({ name: "write_file", arguments: { path: "src/main.c", content: "x" } }, "full"), "allow");
  assert.equal(permissions.verdict({ name: "run_terminal", arguments: { command: "git commit -m test" } }, "full"), "ask");

  const events = [];
  const controller = new LiixAgentController((event) => events.push(event), async () => "allowOnce");
  await controller.run("Lis src/main.c puis résume-le.", "agent", "integration", "mock-coder");
  assert.equal(agentTurns, 2);
  assert.equal(toolResultReinjected, true);
  assert.ok(events.some((event) => event.type === "tool" && event.event.name === "read_file" && event.event.state === "success"));
  assert.ok(events.some((event) => event.type === "usage" && event.usage?.totalTokens === 51));

  const cancelEvents = [];
  const cancelController = new LiixAgentController((event) => cancelEvents.push(event), async () => "allowOnce");
  const pending = cancelController.run("attends indéfiniment", "chat", "cancel", "mock-coder");
  setTimeout(() => cancelController.cancel(), 40);
  await pending;
  assert.ok(cancelEvents.some((event) => event.type === "done" && event.cancelled === true));
  controller.dispose();
  cancelController.dispose();
});

function createVscodeMock(workspace, settings) {
  return {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: workspace } }],
      getConfiguration: () => ({
        get: (key, fallback) => settings.has(key) ? settings.get(key) : fallback,
        update: async (key, value) => settings.set(key, value)
      }),
      textDocuments: [],
      findFiles: async () => [],
      fs: { writeFile: async () => {}, delete: async () => {}, stat: async () => ({ type: 1 }) }
    },
    window: { activeTextEditor: undefined },
    languages: { getDiagnostics: () => [] },
    commands: { executeCommand: async () => {} },
    Uri: { file: (fsPath) => ({ fsPath }) },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    FileType: { File: 1, Directory: 2 },
    DiagnosticSeverity: { 0: "Error", 1: "Warning", 2: "Information", 3: "Hint", Error: 0, Warning: 1 }
  };
}
