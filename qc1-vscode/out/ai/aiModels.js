"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.liixAiModels = exports.modelOptions = exports.modelMap = exports.LIIX_MODELS = void 0;
exports.getAiModelLabel = getAiModelLabel;
exports.getBackendModelId = getBackendModelId;
exports.getModelOptions = getModelOptions;
exports.LIIX_MODELS = [
    {
        id: "liix-code-0.1",
        name: "Liix Code 0.1"
    },
    {
        id: "liix-code-0.1-mini",
        name: "Liix Code 0.1 Mini"
    },
    {
        id: "liix-code-a1",
        name: "Liix Code A1"
    }
];
exports.modelMap = {
    "liix-code-0.1": "liix-code-0.1-alpha-experimental:latest",
    "liix-code-0.1-mini": "qwen2.5-coder:7b-instruct",
    "liix-code-a1": "liix-code-0.1A:latest"
};
exports.modelOptions = {
    "liix-code-0.1": {
        temperature: 0.15,
        top_p: 0.9
    },
    "liix-code-0.1-mini": {
        temperature: 0.12,
        top_p: 0.9
    },
    "liix-code-a1": {
        temperature: 0.2,
        top_p: 0.92
    }
};
exports.liixAiModels = [
    {
        id: exports.LIIX_MODELS[0].id,
        name: exports.LIIX_MODELS[0].name,
        label: exports.LIIX_MODELS[0].name,
        status: "training",
        description: "Specialise en code C pour STM32 F1 et F3"
    },
    {
        id: exports.LIIX_MODELS[1].id,
        name: exports.LIIX_MODELS[1].name,
        label: exports.LIIX_MODELS[1].name,
        status: "training",
        description: "Version plus legere de Liix Code"
    },
    {
        id: exports.LIIX_MODELS[2].id,
        name: exports.LIIX_MODELS[2].name,
        label: exports.LIIX_MODELS[2].name,
        status: "training",
        description: "Liix Code Agentic 1"
    }
];
function getAiModelLabel(modelId) {
    return exports.liixAiModels.find((model) => model.id === modelId)?.label ?? exports.liixAiModels[0].label;
}
function getBackendModelId(modelId) {
    return exports.modelMap[modelId] ?? exports.modelMap[exports.liixAiModels[0].id];
}
function getModelOptions(modelId) {
    return exports.modelOptions[modelId] ?? exports.modelOptions[exports.liixAiModels[0].id];
}
//# sourceMappingURL=aiModels.js.map