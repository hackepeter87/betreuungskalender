import nodemailer from "nodemailer";

export interface SmtpMailConfig {
  smtpHost?: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom?: string;
  smtpFromName?: string;
}

export interface TextMailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface TextMailTransport {
  sendMail(message: TextMailMessage): Promise<unknown> | unknown;
}

export type TextMailTransportFactory = (config: SmtpMailConfig) => TextMailTransport;

export function smtpMailAvailable(config: SmtpMailConfig): boolean {
  return Boolean(config.smtpHost?.trim() && config.smtpFrom?.trim());
}

export function smtpTransportOptions(config: SmtpMailConfig) {
  return {
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    disableFileAccess: true,
    disableUrlAccess: true,
    ...(config.smtpUser && config.smtpPassword
      ? {
          auth: {
            user: config.smtpUser,
            pass: config.smtpPassword
          }
        }
      : {})
  };
}

export const createSmtpTransport: TextMailTransportFactory = (config) =>
  nodemailer.createTransport(smtpTransportOptions(config));

function sanitizeDisplayName(value?: string): string | undefined {
  const normalized = value?.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 120) : undefined;
}

function escapeDisplayName(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function smtpSenderAddress(smtpFrom: string, smtpFromName?: string): string {
  const displayName = sanitizeDisplayName(smtpFromName);
  if (!displayName) return smtpFrom;
  const from = smtpFrom.trim();
  const address = from.match(/<([^<>]+)>/)?.[1]?.trim() || from;
  return `"${escapeDisplayName(displayName)}" <${address}>`;
}
