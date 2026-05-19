export interface AiModel {
  id: string;
  name: string;
  label: string;
  status: "training";
  description: string;
}

export const LIIX_MODELS = [
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

export const modelMap: Record<string, string> = {
  "liix-code-0.1": "liix-code-0.1",
  "liix-code-0.1-mini": "liix-code-0.1-mini",
  "liix-code-a1": "liix-code-a1"
};

export const modelOptions: Record<string, { temperature: number; top_p: number }> = {
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

export const liixAiModels: AiModel[] = [
  {
    id: LIIX_MODELS[0].id,
    name: LIIX_MODELS[0].name,
    label: LIIX_MODELS[0].name,
    status: "training",
    description: "Specialise en code C pour STM32 F1 et F3"
  },
  {
    id: LIIX_MODELS[1].id,
    name: LIIX_MODELS[1].name,
    label: LIIX_MODELS[1].name,
    status: "training",
    description: "Version plus legere de Liix Code"
  },
  {
    id: LIIX_MODELS[2].id,
    name: LIIX_MODELS[2].name,
    label: LIIX_MODELS[2].name,
    status: "training",
    description: "Liix Code Agentic 1"
  }
];

export function getAiModelLabel(modelId: string): string {
  return liixAiModels.find((model) => model.id === modelId)?.label ?? liixAiModels[0].label;
}

export function getBackendModelId(modelId: string): string {
  return modelMap[modelId] ?? modelMap[liixAiModels[0].id];
}

export function getModelOptions(modelId: string): { temperature: number; top_p: number } {
  return modelOptions[modelId] ?? modelOptions[liixAiModels[0].id];
}
