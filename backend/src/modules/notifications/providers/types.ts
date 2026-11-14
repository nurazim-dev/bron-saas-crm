export interface EmailSendParams {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  send(params: EmailSendParams): Promise<void>;
}

export interface TelegramSendParams {
  chatId: string;
  html: string;
}

export interface TelegramProvider {
  send(params: TelegramSendParams): Promise<void>;
}

export interface ClientMessageSendParams {
  channel: 'SMS' | 'WHATSAPP';
  to: string;
  text: string;
}

export interface ClientMessageProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  send(params: ClientMessageSendParams): Promise<void>;
}
