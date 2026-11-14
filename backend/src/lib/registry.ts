import { LogClientMessageProvider } from '../modules/notifications/providers/client-message.provider.js';
import { NodemailerEmailProvider } from '../modules/notifications/providers/email.provider.js';
import { HttpTelegramProvider } from '../modules/notifications/providers/telegram.provider.js';
import type {
  ClientMessageProvider,
  EmailProvider,
  TelegramProvider,
} from '../modules/notifications/providers/types.js';

export interface ProviderRegistry {
  email: EmailProvider;
  telegram: TelegramProvider;
  clientMessage: ClientMessageProvider;
}

function createDefaultRegistry(): ProviderRegistry {
  return {
    email: new NodemailerEmailProvider(),
    telegram: new HttpTelegramProvider(),
    clientMessage: new LogClientMessageProvider(),
  };
}

let activeRegistry: ProviderRegistry = createDefaultRegistry();

export function getProviderRegistry(): ProviderRegistry {
  return activeRegistry;
}

export function setProviderRegistry(overrides: Partial<ProviderRegistry>): void {
  const defaults = createDefaultRegistry();
  activeRegistry = {
    email: overrides.email ?? defaults.email,
    telegram: overrides.telegram ?? defaults.telegram,
    clientMessage: overrides.clientMessage ?? defaults.clientMessage,
  };
}

export function resetProviderRegistry(): void {
  activeRegistry = createDefaultRegistry();
}
