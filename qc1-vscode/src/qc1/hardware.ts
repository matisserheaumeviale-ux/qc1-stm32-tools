export type StlinkProbeStatus = "OK" | "non détecté" | "non testé";

export function readStlinkProbeStatus(output: string): StlinkProbeStatus {
  const lower = output.toLowerCase();

  if (
    lower.includes("found 0 stlink") ||
    lower.includes("no device found") ||
    lower.includes("no st-link") ||
    lower.includes("st-link not found") ||
    lower.includes("stlink not found") ||
    lower.includes("unable to connect")
  ) {
    return "non détecté";
  }

  if (
    /found\s+[1-9]\d*\s+stlink/.test(lower) ||
    lower.includes("st-link") ||
    lower.includes("stlink") ||
    lower.includes("target voltage") ||
    lower.includes("device connected")
  ) {
    return "OK";
  }

  return "non testé";
}

export function getOpenOcdServerArgs(): string[] {
  return ["-f", "interface/stlink.cfg", "-f", "target/stm32f1x.cfg"];
}

export function getOpenOcdProgramArgs(elfPath: string): string[] {
  return [...getOpenOcdServerArgs(), "-c", `program {${elfPath}} verify reset exit`];
}

export function getStFlashWriteArgs(binPath: string): string[] {
  return ["--reset", "write", binPath, "0x08000000"];
}
