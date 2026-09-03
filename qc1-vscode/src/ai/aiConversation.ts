/**
 * RÉSUMÉ — HISTORIQUE ET BUDGET DE CONTEXTE LIIX
 *
 * Une instance représente une conversation de session. Elle conserve les rôles
 * system/user/assistant/tool, compresse les gros résultats d'outils et n'envoie au
 * modèle que la partie récente qui respecte le budget configuré.
 */

import { createMessage, LiixConversationMessage, LiixToolCall } from "./aiProtocol";

const DEFAULT_CONTEXT_CHARS = 80_000;
const MAX_TOOL_RESULT_CHARS = 12_000;

export class LiixConversationManager {
  private messages: LiixConversationMessage[] = [];

  constructor(private readonly systemPrompt: string, private readonly contextChars = DEFAULT_CONTEXT_CHARS) {
    this.reset();
  }

  reset(): void {
    this.messages = [createMessage("system", this.systemPrompt)];
  }

  addUser(content: string): LiixConversationMessage {
    return this.add(createMessage("user", content));
  }

  addAssistant(content: string, toolCalls: LiixToolCall[] = []): LiixConversationMessage {
    return this.add(createMessage("assistant", content, { toolCalls }));
  }

  addTool(toolCallId: string, toolName: string, content: string): LiixConversationMessage {
    const compact = content.length > MAX_TOOL_RESULT_CHARS
      ? `${content.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[Résultat tronqué par Liix]`
      : content;
    return this.add(createMessage("tool", compact, { toolCallId, toolName }));
  }

  snapshot(): LiixConversationMessage[] {
    return this.messages.map((message) => ({ ...message, toolCalls: message.toolCalls?.map((call) => ({ ...call, arguments: { ...call.arguments } })) }));
  }

  modelContext(): LiixConversationMessage[] {
    if (this.totalChars(this.messages) <= this.contextChars) return this.snapshot();

    const system = this.messages[0];
    const kept: LiixConversationMessage[] = [];
    let used = system.content.length;
    for (let index = this.messages.length - 1; index >= 1; index -= 1) {
      const message = this.messages[index];
      const size = message.content.length + 200;
      if (kept.length > 0 && used + size > this.contextChars) break;
      kept.unshift(message);
      used += size;
    }
    const omitted = this.messages.length - kept.length - 1;
    const summary = omitted > 0
      ? [createMessage("system", `${omitted} ancien(s) message(s) ont été retirés du contexte actif pour respecter la fenêtre du modèle.`)]
      : [];
    return [system, ...summary, ...kept].map((message) => ({ ...message }));
  }

  private add(message: LiixConversationMessage): LiixConversationMessage {
    this.messages.push(message);
    return message;
  }

  private totalChars(messages: LiixConversationMessage[]): number {
    return messages.reduce((total, message) => total + message.content.length + 200, 0);
  }
}
