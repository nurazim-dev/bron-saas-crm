import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../../config/env.js';
import { ProviderDeliveryError } from '../errors.js';
import type { EmailProvider, EmailSendParams } from './types.js';

export class NodemailerEmailProvider implements EmailProvider {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        ...(env.SMTP_USER.length > 0
          ? {
              auth: {
                user: env.SMTP_USER,
                pass: env.SMTP_PASS,
              },
            }
          : {}),
      });
    }
    return this.transporter;
  }

  async send(params: EmailSendParams): Promise<void> {
    if (!params.to.includes('@')) {
      throw new ProviderDeliveryError('Invalid email recipient address', true, 'INVALID_RECIPIENT');
    }
    const transporter = this.getTransporter();
    await transporter.sendMail({
      from: env.MAIL_FROM,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
  }
}
