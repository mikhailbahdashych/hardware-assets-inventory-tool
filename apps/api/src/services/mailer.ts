import nodemailer from 'nodemailer';
import type { Config } from '@/types/config.js';
import type { Mailer } from '@/types/mail.js';

/**
 * The SMTP transport, or `null` when this instance has no SMTP configured —
 * which is a supported way to run it, not a misconfiguration. Everything that
 * would email has a link-based path that works without one.
 */
export function createMailer(config: Config): Mailer | null {
  const smtp = config.smtp;
  if (!smtp) return null;

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    // A relay on a private network often wants no credentials at all.
    auth: smtp.auth ?? undefined,
  });

  return {
    send: async (message) => {
      await transport.sendMail({ from: smtp.from, ...message });
    },
  };
}
