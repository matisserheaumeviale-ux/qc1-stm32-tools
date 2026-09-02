const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  findStm32Project,
  inspectStm32Project,
  isUsableStm32Project,
  resolveConfiguredProjectPath
} = require("../out/qc1/projectDiscovery");

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "qc1-project-test-"));
}

function write(filePath, content = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

test("detects a native bare-metal CMake project without Core or Drivers", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "CMakeLists.txt"), "project(Prog3-Lab-0)\n");
  write(path.join(root, "Src", "main.c"), "int main(void) { return 0; }\n");
  write(path.join(root, "Src", "startup_stm32f103xb.s"));
  write(path.join(root, "stm32f103xb_flash.ld"), "MEMORY {}\n");

  const inspection = inspectStm32Project(root);
  assert.equal(inspection.layout, "native-cmake");
  assert.equal(inspection.projectName, "Prog3-Lab-0");
  assert.equal(isUsableStm32Project(inspection), true);
  assert.equal(inspection.startupPath, path.join(root, "Src", "startup_stm32f103xb.s"));
});

test("ignores stale linker scripts under build and selects the source F103 linker", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(path.join(root, "CMakeLists.txt"), "project(firmware)\n");
  write(path.join(root, "Src", "main.c"));
  write(path.join(root, "Src", "startup_stm32f103xb.s"));
  write(path.join(root, "stm32f103xb_flash.ld"));
  write(path.join(root, "build", "Debug", "stm32f102xb_flash.ld"));

  assert.equal(inspectStm32Project(root).linkerScriptPath, path.join(root, "stm32f103xb_flash.ld"));
});

test("finds a nested native CMake firmware when auto-detection scans a workspace", (t) => {
  const workspace = fixture();
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const project = path.join(workspace, "course", "labs", "Lab 0", "Prog3-Lab-0");
  write(path.join(project, "CMakeLists.txt"), "project(Prog3-Lab-0)\n");
  write(path.join(project, "Src", "main.c"));
  write(path.join(project, "Src", "startup_stm32f103xb.s"));
  write(path.join(project, "stm32f103xb_flash.ld"));

  assert.equal(findStm32Project(workspace)?.root, project);
});

test("resolves a configured project path relative to the workspace", () => {
  assert.equal(
    resolveConfiguredProjectPath("labs/firmware", "/workspace"),
    path.resolve("/workspace/labs/firmware")
  );
});
