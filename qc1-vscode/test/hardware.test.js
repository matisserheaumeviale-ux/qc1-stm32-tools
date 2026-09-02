const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getOpenOcdProgramArgs,
  getOpenOcdServerArgs,
  getStFlashWriteArgs,
  readStlinkProbeStatus
} = require("../out/qc1/hardware");

test("parses real st-info probe counts", () => {
  assert.equal(readStlinkProbeStatus("Found 1 stlink programmers"), "OK");
  assert.equal(readStlinkProbeStatus("Found 0 stlink programmers"), "non détecté");
  assert.equal(readStlinkProbeStatus("unrelated output"), "non testé");
});

test("builds configured OpenOCD STM32F1 arguments", () => {
  assert.deepEqual(getOpenOcdServerArgs(), [
    "-f", "interface/stlink.cfg", "-f", "target/stm32f1x.cfg"
  ]);
  assert.deepEqual(getOpenOcdProgramArgs("/tmp/firmware.elf"), [
    "-f", "interface/stlink.cfg", "-f", "target/stm32f1x.cfg",
    "-c", "program {/tmp/firmware.elf} verify reset exit"
  ]);
});

test("requests a reset from the st-flash fallback", () => {
  assert.deepEqual(getStFlashWriteArgs("firmware.bin"), [
    "--reset", "write", "firmware.bin", "0x08000000"
  ]);
});
