import type { AiService } from '../../ai/ai-service.js';
import type { KeyStore } from '../../ai/key-store.js';
import { registerHandler } from '../router.js';

/**
 * AI handlers (M5, BYOK). The key is write-only from the renderer's side: `ai:setKey` accepts one and
 * hands it to the keychain-backed store; no channel ever returns it. `ai:run` grounds a task on a
 * stored finding and streams the result — the secret gate runs inside the service before any provider
 * call, so a hostile renderer cannot route around it by calling here.
 */
export function registerAiHandlers(deps: { keyStore: KeyStore; aiService: AiService }): void {
  registerHandler('ai:getConfig', () => deps.keyStore.getConfig());

  registerHandler('ai:setKey', ({ key, model }) => deps.keyStore.setKey(key, model));

  registerHandler('ai:clearKey', () => deps.keyStore.clearKey());

  registerHandler('ai:setModel', ({ model }) => deps.keyStore.setModel(model));

  registerHandler('ai:run', (request, { window }) => deps.aiService.run(request, window));

  registerHandler('ai:cancel', () => {
    deps.aiService.cancel();
  });
}
