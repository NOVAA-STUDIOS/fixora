import log from 'electron-log';

import type { ZapprService } from '../../services/zappr-service.js';
import { registerHandler } from '../router.js';

export function registerZapprHandlers(service: ZapprService): void {
  registerHandler('zappr:run', async ({ runId, prompt, activeFile, openTabs, selectedCode, selectedCodeFile, atMentions, smartContextFiles }) => {
    log.debug('[Zappr:IPC] Channel received', { channel: 'zappr:run' });
    try {
      return await service.run(runId, prompt, activeFile ?? null, openTabs ?? [], selectedCode ?? null, selectedCodeFile ?? null, atMentions ?? [], smartContextFiles ?? []);
    } catch (error) {
      log.error('[Zappr:IPC] Handler error', { channel: 'zappr:run', error: String(error) });
      throw error;
    }
  });

  registerHandler('zappr:cancel', ({ runId }) => {
    log.debug('[Zappr:IPC] Channel received', { channel: 'zappr:cancel' });
    try {
      service.cancel(runId);
    } catch (error) {
      log.error('[Zappr:IPC] Handler error', { channel: 'zappr:cancel', error: String(error) });
      throw error;
    }
  });

  registerHandler('zappr:approvePlan', async ({ approvalId, runId }) => {
    log.debug('[Zappr:IPC] Channel received', { channel: 'zappr:approvePlan' });
    return await service.approvePlan(approvalId, runId);
  });

  registerHandler('zappr:rejectPlan', ({ approvalId, runId }) => {
    log.debug('[Zappr:IPC] Channel received', { channel: 'zappr:rejectPlan' });
    return service.rejectPlan(approvalId, runId);
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
