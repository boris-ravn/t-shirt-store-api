import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(configService: ConfigService) {
    this.from = configService.getOrThrow<string>('SMTP_FROM');
    this.transporter = createTransport({
      host: configService.getOrThrow<string>('SMTP_HOST'),
      port: configService.getOrThrow<number>('SMTP_PORT'),
      secure: false,
    });
  }

  async sendPasswordResetEmail(
    to: string,
    firstName: string,
    token: string,
  ): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Reset your password',
      text: `Hi ${firstName},\n\nUse this code to reset your T-Shirt Store password: ${token}\n\nIf you didn't request this, ignore this email.`,
    });
    this.logger.log(`Password-reset email sent to ${to}`);
  }

  async sendPasswordChangedEmail(to: string, firstName: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: 'Your password was changed',
      text: `Hi ${firstName},\n\nYour T-Shirt Store password was just changed. If this wasn't you, contact support immediately.`,
    });
    this.logger.log(`Password-changed email sent to ${to}`);
  }
}
