import type { ZapprService } from '../../services/zappr-service.js';
import { registerHandler } from '../router.js';

export function registerZapprHandlers(service: ZapprService): void {
  registerHandler('zappr:run', ({ prompt }) => service.run(prompt));

  registerHandler('zappr:cancel', () => {
    service.cancel();
  });

  registerHandler('zappr:getContext', () => service.getContext());
}
