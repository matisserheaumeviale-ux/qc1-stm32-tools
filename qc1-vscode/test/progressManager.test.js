const assert = require("node:assert/strict");
const test = require("node:test");

const { ProgressManager } = require("../out/dashboard/progressManager");

test("computes real Ninja progress from a complete line", (t) => {
  const updates = [];
  const manager = new ProgressManager((progress) => updates.push(progress));
  t.after(() => manager.dispose());

  manager.start("build");
  manager.setPhase("building", "Compilation Ninja");
  manager.consumeOutput("[14/37] Building C object Src/main.c.o\n");

  const progress = updates.at(-1);
  assert.equal(progress.completedSteps, 14);
  assert.equal(progress.totalSteps, 37);
  assert.equal(progress.progressPercent, 38);
  assert.equal(progress.measured, true);
  assert.match(progress.currentStep, /Building C object/);
});

test("parses Ninja progress split across stdout chunks", (t) => {
  const updates = [];
  const manager = new ProgressManager((progress) => updates.push(progress));
  t.after(() => manager.dispose());

  manager.start("build");
  manager.consumeOutput("[2");
  manager.consumeOutput("1/42] Linking firmware.elf\r");

  const progress = updates.at(-1);
  assert.equal(progress.completedSteps, 21);
  assert.equal(progress.totalSteps, 42);
  assert.equal(progress.progressPercent, 50);
});

test("finishes at 100 percent only on success", (t) => {
  const updates = [];
  const manager = new ProgressManager((progress) => updates.push(progress));
  t.after(() => manager.dispose());

  manager.start("build");
  manager.consumeOutput("[3/10] Compiling\n");
  manager.finish(false, "Compilation échouée");
  assert.equal(updates.at(-1).progressPercent, 30);
  assert.equal(updates.at(-1).phase, "error");

  manager.start("build");
  manager.finish(true, "Compilation terminée");
  assert.equal(updates.at(-1).progressPercent, 100);
  assert.equal(updates.at(-1).phase, "complete");
});
