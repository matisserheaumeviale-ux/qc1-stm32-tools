"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.liixAiModels = void 0;
exports.getAiModelLabel = getAiModelLabel;
exports.liixAiModels = [
    {
        id: "liix-code-0-1",
        label: "Liix Code 0.1",
        status: "training",
        description: "Specialise en code C pour STM32 F1 et F3"
    },
    {
        id: "liix-code-0-1-mini",
        label: "Liix Code 0.1 Mini",
        status: "training",
        description: "Version plus legere de Liix Code"
    },
    {
        id: "liix-code-a1",
        label: "Liix Code A1",
        status: "training",
        description: "Liix Code Agentic 1"
    }
];
function getAiModelLabel(modelId) {
    return exports.liixAiModels.find((model) => model.id === modelId)?.label ?? exports.liixAiModels[0].label;
}
//# sourceMappingURL=aiModels.js.map