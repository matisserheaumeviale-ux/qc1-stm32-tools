import { getAiModelLabel } from "./aiModels";

export interface AiChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AiClientRequest {
  modelId: string;
  message: string;
  context?: string;
  mode?: "chat" | "file" | "errors";
}

export interface AiClientResponse {
  modelId: string;
  content: string;
  simulated: boolean;
}

export class LiixAiClient {
  public async sendMessage(request: AiClientRequest): Promise<AiClientResponse> {
    return this.sendMockResponse(request);
  }

  private async sendMockResponse(request: AiClientRequest): Promise<AiClientResponse> {
    const modelLabel = getAiModelLabel(request.modelId);
    const contextNote = request.context
      ? "\n\nContexte recu par le mode dev. Le futur serveur Liix pourra l'utiliser pour une analyse reelle."
      : "";

    return {
      modelId: request.modelId,
      simulated: true,
      content:
        `[${modelLabel}] Reponse simulee en mode mock/dev.\n\n` +
        "Les modeles Liix Code sont encore en entrainement. " +
        "Cette architecture est prete pour brancher plus tard le serveur distant Liix sans changer l'interface VSCode." +
        `${contextNote}\n\nMessage: ${request.message}`
    };
  }
}
