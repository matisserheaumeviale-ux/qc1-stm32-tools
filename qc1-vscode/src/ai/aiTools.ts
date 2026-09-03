/**
 * RÉSUMÉ — REGISTRE DES OUTILS STRUCTURÉS LIIX
 *
 * Le modèle ne reçoit jamais Node.js ou l'API VS Code. Il voit seulement cette liste
 * de fonctions JSON, avec leurs paramètres et leur niveau de risque. L'exécuteur
 * valide ensuite chaque demande avant de toucher au workspace.
 */

import type { LiixAgentMode, LiixRisk } from "./aiAgent";
import type { LiixToolDefinition } from "./aiProtocol";

export interface LiixToolMetadata {
  definition: LiixToolDefinition;
  risk: LiixRisk;
  modes: LiixAgentMode[];
  mutates: boolean;
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});

const stringPath = { type: "string", description: "Chemin relatif au workspace actif." };

export const LIIX_TOOL_REGISTRY: LiixToolMetadata[] = [
  tool("read_file", "Lire une plage d'un fichier UTF-8 du workspace.", objectSchema({
    path: stringPath,
    startLine: { type: "number", minimum: 1 },
    endLine: { type: "number", minimum: 1 }
  }, ["path"]), "LOW", ["chat", "agent", "full"]),
  tool("list_directory", "Lister un dossier du workspace sans parcourir les dossiers ignorés.", objectSchema({ path: stringPath }), "LOW", ["chat", "agent", "full"]),
  tool("search_files", "Trouver des fichiers par motif glob dans le workspace.", objectSchema({ pattern: { type: "string" }, path: stringPath }, ["pattern"]), "LOW", ["chat", "agent", "full"]),
  tool("search_text", "Chercher du texte avec ripgrep et retourner les correspondances avec lignes.", objectSchema({
    query: { type: "string" }, path: stringPath, glob: { type: "string" }, maxResults: { type: "number", minimum: 1, maximum: 200 }
  }, ["query"]), "LOW", ["chat", "agent", "full"]),
  tool("get_active_file", "Retourner le fichier actif et son contenu sélectionné de façon limitée.", objectSchema({}), "LOW", ["chat", "agent", "full"]),
  tool("get_selection", "Retourner la sélection actuelle de l'éditeur.", objectSchema({}), "LOW", ["chat", "agent", "full"]),
  tool("get_diagnostics", "Lire les diagnostics VS Code du workspace ou d'un fichier.", objectSchema({ path: stringPath }), "LOW", ["chat", "agent", "full"]),
  tool("inspect_project", "Inspecter l'arborescence et les fichiers de configuration importants.", objectSchema({}), "LOW", ["chat", "agent", "full"]),
  tool("git_status", "Lire git status --short et la branche active.", objectSchema({}), "LOW", ["chat", "agent", "full"]),
  tool("git_diff", "Lire le diff Git sans modifier l'index.", objectSchema({ path: stringPath, staged: { type: "boolean" } }), "LOW", ["chat", "agent", "full"]),
  tool("git_log", "Lire les derniers commits Git.", objectSchema({ limit: { type: "number", minimum: 1, maximum: 30 } }), "LOW", ["chat", "agent", "full"]),
  tool("git_show", "Afficher un objet ou commit Git sans modifier le workspace.", objectSchema({ revision: { type: "string" } }, ["revision"]), "LOW", ["chat", "agent", "full"]),
  tool("write_file", "Remplacer entièrement un fichier existant après permission.", objectSchema({ path: stringPath, content: { type: "string" } }, ["path", "content"]), "MEDIUM", ["agent", "full"], true),
  tool("create_file", "Créer un nouveau fichier dans le workspace après permission.", objectSchema({ path: stringPath, content: { type: "string" } }, ["path", "content"]), "MEDIUM", ["agent", "full"], true),
  tool("apply_patch", "Remplacer exactement oldText par newText dans un fichier après permission.", objectSchema({
    path: stringPath, oldText: { type: "string" }, newText: { type: "string" }, replaceAll: { type: "boolean" }
  }, ["path", "oldText", "newText"]), "MEDIUM", ["agent", "full"], true),
  tool("delete_file", "Supprimer un fichier unique du workspace vers la corbeille après confirmation.", objectSchema({ path: stringPath }, ["path"]), "HIGH", ["agent", "full"], true),
  tool("run_terminal", "Exécuter une commande contrôlée dans le workspace et capturer stdout/stderr en direct.", objectSchema({ command: { type: "string" }, cwd: stringPath }, ["command"]), "MEDIUM", ["agent", "full"]),
  tool("build_project", "Détecter puis exécuter le build CMake ou npm du projet.", objectSchema({ command: { type: "string", description: "Commande facultative; sinon Liix la détecte." } }), "MEDIUM", ["agent", "full"]),
  tool("run_tests", "Exécuter les tests détectés dans le projet et capturer leur sortie.", objectSchema({ command: { type: "string", description: "Commande de test facultative." } }), "MEDIUM", ["agent", "full"])
];

export function getToolMetadata(name: string): LiixToolMetadata | undefined {
  return LIIX_TOOL_REGISTRY.find((tool) => tool.definition.function.name === name);
}

export function getToolsForMode(mode: LiixAgentMode): LiixToolDefinition[] {
  return LIIX_TOOL_REGISTRY.filter((entry) => entry.modes.includes(mode)).map((entry) => entry.definition);
}

function tool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  risk: LiixRisk,
  modes: LiixAgentMode[],
  mutates = false
): LiixToolMetadata {
  return { definition: { type: "function", function: { name, description, parameters } }, risk, modes, mutates };
}
