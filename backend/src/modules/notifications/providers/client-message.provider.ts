import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { maskPhone, ProviderDeliveryError } from '../errors.js';
import type { ClientMessageProvider, ClientMessageSendParams } from './types.js';

export class LogClientMessageProvider implements ClientMessageProvider {
  readonly name: string;
  readonly isConfigured: boolean;

  constructor() {
    this.name = env.CLIENT_MESSAGE_PROVIDER;
    this.isConfigured = false;
  }

  send(params: ClientMessageSendParams): Promise<void> {
    if (env.CLIENT_MESSAGE_PROVIDER === 'off') {
      return Promise.reject(
        new ProviderDeliveryError(
          'Client message provider is disabled (off)',
          true,
          'PROVIDER_OFF',
        ),
      );
    }

    logger.info(
      {
        channel: params.channel,
        recipientMasked: maskPhone(params.to),
        textLength: params.text.length,
        provider: this.name,
      },
      'Client message logged by LogClientMessageProvider',
    );
    return Promise.resolve();
  }
}
