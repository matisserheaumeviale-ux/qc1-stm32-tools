const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  finalizeToolCallDeltas,
  mergeToolCallDeltas,
  parseFallbackToolCalls,
  parseOpenAiTurn,
  splitSseEvents
} = require("../out/ai/aiProtocol");
const { LiixConversationManager } = require("../out/ai/aiConversation");
const { assertSafeCommand, classifyToolRisk, resolveInsideWorkspace } = require("../out/ai/aiSafety");

test("parses native OpenAI tool calls", () => {
  const turn = parseOpenAiTurn({
    model: "qwen-coder",
    choices: [{ message: { content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: '{"path":"src/main.c"}' } }] } }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
  }, 12);
  assert.equal(turn.toolCalls[0].name, "read_file");
  assert.deepEqual(turn.toolCalls[0].arguments, { path: "src/main.c" });
  assert.equal(turn.usage.totalTokens, 14);
});

test("parses structured fallback tool calls without exposing the tag", () => {
  const parsed = parseFallbackToolCalls('Je vérifie.\n<tool_call>{"name":"git_status","arguments":{}}</tool_call>');
  assert.equal(parsed.content, "Je vérifie.");
  assert.equal(parsed.toolCalls[0].name, "git_status");
});

test("keeps split SSE events and merges fragmented arguments", () => {
  const first = splitSseEvents('data: {"a":1}\n\ndata: {"b"');
  assert.deepEqual(first.data, ['{"a":1}']);
  const second = splitSseEvents(first.rest + ':2}\n\n');
  assert.deepEqual(second.data, ['{"b":2}']);
  const calls = new Map();
  mergeToolCallDeltas(calls, [{ index: 0, id: "x", function: { name: "read_", arguments: '{"path":"src/' } }]);
  mergeToolCallDeltas(calls, [{ index: 0, function: { name: "file", arguments: 'main.c"}' } }]);
  assert.deepEqual(finalizeToolCallDeltas(calls)[0], { id: "x", name: "read_file", arguments: { path: "src/main.c" } });
});

test("conversation budget retains system and recent messages", () => {
  const conversation = new LiixConversationManager("system", 900);
  for (let index = 0; index < 10; index += 1) conversation.addUser(`message-${index}-` + "x".repeat(200));
  const context = conversation.modelContext();
  assert.equal(context[0].role, "system");
  assert.match(context.at(-1).content, /message-9/);
  assert.ok(context.length < 11);
});

test("blocks paths outside the workspace", () => {
  const root = path.resolve("/tmp/liix-workspace");
  assert.equal(resolveInsideWorkspace(root, "src/main.c"), path.join(root, "src/main.c"));
  assert.throws(() => resolveInsideWorkspace(root, "../secret.txt"), /hors workspace/);
  assert.throws(() => resolveInsideWorkspace(root, "/etc/passwd"), /hors workspace/);
});

test("blocks destructive commands even in a controlled terminal", () => {
  assert.doesNotThrow(() => assertSafeCommand("cmake --build build/qc1"));
  assert.throws(() => assertSafeCommand("git reset --hard HEAD"), /destructive/);
  assert.throws(() => assertSafeCommand("rm -rf build"), /destructive/);
  assert.throws(() => assertSafeCommand("sudo make install"), /destructive/);
  assert.throws(() => assertSafeCommand("git push --force origin main"), /destructive/);
  assert.throws(() => assertSafeCommand("cat ../outside.txt"), /destructive/);
  assert.throws(() => assertSafeCommand("cat /etc/passwd"), /destructive/);
  assert.equal(classifyToolRisk({ name: "run_terminal", arguments: { command: "git commit -m test" } }, "MEDIUM"), "HIGH");
  assert.equal(classifyToolRisk({ name: "run_terminal", arguments: { command: "python -c 'print(1)'" } }, "MEDIUM"), "HIGH");
  assert.equal(classifyToolRisk({ name: "run_terminal", arguments: { command: "cmake --build build" } }, "MEDIUM"), "MEDIUM");
});
