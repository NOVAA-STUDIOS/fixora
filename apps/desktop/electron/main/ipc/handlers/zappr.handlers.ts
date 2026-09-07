import log from 'electron-log';

import type { ZapprService } from '../../services/zappr-service.js';
import { registerHandler } from '../router.js';

export function registerZapprHandlers(service: ZapprService): void {
  registerHandler('zappr:run', async ({ prompt, activeFile, openTabs }) => {
    log.debug('[Zappr:IPC] Channel received', { channel: 'zappr:run' });
    try {
      return await service.run(prompt, activeFile ?? null, openTabs ?? []);
    } catch (error) {
      log.error('[Zappr:IPC] Handler error', { channel: 'zappr:run', error: String(error) });
      throw error;
    }
  });

  registerHandler('zappr:cancel', () => {
    log.debug('[Zappr:IPC] Channel received', { channel: 'zappr:cancel' });
    try {
      service.cancel();
    } catch (error) {
      log.error('[Zappr:IPC] Handler error', { channel: 'zappr:cancel', error: String(error) });
      throw error;
    }
  });

  registerHandler('zappr:getContext', async () => {
    log.debug('[Zappr:IPC] Channel received', { channel: 'zappr:getContext' });
    try {
      return await service.getContext();
    } catch (error) {
      log.error('[Zappr:IPC] Handler error', { channel: 'zappr:getContext', error: String(error) });
      throw error;
    }
  });
}
