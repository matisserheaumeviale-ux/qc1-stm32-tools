const test = require("node:test");
const assert = require("node:assert/strict");
const { getLiixWebviewHtml } = require("../out/ai/aiWebviewHtml");

test("builds a CSP-safe Liix webview with valid script and responsive controls", () => {
  const html = getLiixWebviewHtml({
    nonce: "testnonce",
    provider: "local",
    model: "qwen-test",
    workspace: "/workspace",
    localApiUrl: "http://localhost:1234",
    localApiType: "openai-compatible",
    toolCallingMode: "auto"
  });
  const script = html.match(/<script nonce="testnonce">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
  const markup = html.slice(0, html.indexOf("<script nonce="));
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["messages", "prompt", "modeSelect", "contextMenu", "terminalOutput", "currentTask", "testConnection"]) {
    assert.ok(ids.includes(id), `missing #${id}`);
  }
  assert.match(html, /\.ai-ring/);
  assert.match(html, /@media\(max-width:320px\)/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /https?:\/\/[^<]*(?:script|stylesheet)/i);
});
