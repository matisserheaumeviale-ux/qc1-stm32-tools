"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseQc1Output = parseQc1Output;
function explainDiagnostic(entry) {
    if (!entry) {
        return "Aucune erreur connue detectee.";
    }
    const lower = entry.message.toLowerCase();
    if (lower.includes("unused variable")) {
        return "Variable declaree mais inutilisee. Supprime-la ou utilise-la reellement.";
    }
    if (lower.includes("implicit declaration")) {
        return "Fonction utilisee sans prototype visible. Verifie le include ou le prototype.";
    }
    if (lower.includes("no such file or directory")) {
        return "Fichier introuvable. Verifie le chemin, le include et les fichiers packages.";
    }
    if (lower.includes("undefined reference")) {
        return "Le linker ne trouve pas le symbole. Verifie le .c compile et les prototypes.";
    }
    if (lower.includes("expected")) {
        return "Erreur de syntaxe C probable. Verifie parenthese, point-virgule ou accolade.";
    }
    if (lower.includes("comparison is always")) {
        return "Comparaison toujours vraie ou fausse. Le type ou la borne est probablement incorrect.";
    }
    if (lower.includes("discarded-qualifiers")) {
        return "Perte de qualifier const/volatile. Verifie le type de pointeur.";
    }
    if (entry.severity === "warning") {
        return "Warning GCC a verifier. Souvent type, variable inutilisee ou conversion implicite.";
    }
    return "Erreur GCC a verifier. Lis la ligne complete et remonte a la premiere erreur utile.";
}
function parseDiagnostic(line) {
    const match = line.match(/^(.*?):(\d+):(\d+):\s*(warning|error):\s*(.*)$/i);
    if (!match) {
        return undefined;
    }
    return {
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        severity: match[4].toLowerCase() === "warning" ? "warning" : "error",
        message: match[5].trim(),
        raw: line
    };
}
function parseQc1Output(output) {
    const lines = output.split(/\r?\n/);
    const diagnostics = [];
    let errors = 0;
    let warnings = 0;
    let hasBuildFailed = false;
    let hasFlashFailed = false;
    let elfGenerated = false;
    let binGenerated = false;
    let flashUsage = "--";
    let ramUsage = "--";
    for (const line of lines) {
        const lower = line.toLowerCase();
        const diagnostic = parseDiagnostic(line);
        if (diagnostic) {
            diagnostics.push(diagnostic);
            if (diagnostic.severity === "error") {
                errors++;
            }
            else {
                warnings++;
            }
        }
        else {
            if (/\bfatal error\b/i.test(line)) {
                errors++;
            }
            if (/\bwarning:/i.test(line)) {
                warnings++;
            }
        }
        if (lower.includes("make: ***") ||
            lower.includes("recipe for target") ||
            lower.includes("build failed") ||
            lower.includes("compilation failed")) {
            hasBuildFailed = true;
        }
        if (lower.includes("flash failed") ||
            lower.includes("openocd failed") ||
            (lower.includes("st-flash") && lower.includes("failed")) ||
            lower.includes("error: libusb") ||
            lower.includes("target voltage") ||
            lower.includes("no device found")) {
            hasFlashFailed = true;
        }
        if (lower.includes(".elf")) {
            elfGenerated = true;
        }
        if (lower.includes(".bin")) {
            binGenerated = true;
        }
        const usageMatch = line.match(/flash(?: usage| used)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?\s*%)/i);
        if (usageMatch?.[1]) {
            flashUsage = usageMatch[1].trim();
        }
        const ramMatch = line.match(/ram(?: usage| used)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?\s*%)/i);
        if (ramMatch?.[1]) {
            ramUsage = ramMatch[1].trim();
        }
        const sizeMatch = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([0-9a-fA-F]+)\s+(.+\.elf)/);
        if (sizeMatch) {
            const text = Number(sizeMatch[1]);
            const data = Number(sizeMatch[2]);
            const bss = Number(sizeMatch[3]);
            flashUsage = `${text + data} bytes`;
            ramUsage = `${data + bss} bytes`;
            elfGenerated = true;
        }
    }
    return {
        errors,
        warnings,
        hasBuildFailed,
        hasFlashFailed,
        elfGenerated,
        binGenerated,
        flashUsage,
        ramUsage,
        diagnostics,
        explanation: explainDiagnostic(diagnostics[0])
    };
}
//# sourceMappingURL=qc1Parser.js.map