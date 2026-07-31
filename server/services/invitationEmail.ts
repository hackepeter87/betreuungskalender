import nodemailer from "nodemailer";
import { config } from "../config.js";
import type { WorkspaceRole } from "../auth.js";

export interface InvitationEmailConfig {
  invitationEmailEnabled: boolean;
  invitationPublicBaseUrl: string;
  smtpHost?: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom?: string;
  smtpFromName?: string;
}

export function invitationEmailAvailable(config: InvitationEmailConfig): boolean {
  return Boolean(
    config.invitationEmailEnabled &&
    config.smtpHost?.trim() &&
    config.smtpFrom?.trim()
  );
}

export interface InvitationEmailInput {
  to?: string;
  token: string;
  role: WorkspaceRole;
  expiresAt: string;
}

export interface InvitationEmailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<unknown> | unknown;
}

export class InvitationEmailError extends Error {
  constructor(
    public readonly code:
      | "email_required"
      | "mail_not_configured"
      | "mail_delivery_failed",
    message: string
  ) {
    super(message);
  }
}

function roleLabel(role: WorkspaceRole): string {
  if (role === "admin") return "Admin";
  if (role === "editor") return "Bearbeiten";
  if (role === "scheduler") return "Termine planen";
  return "Ansehen";
}

export function invitationUrl(token: string, baseUrl: string): string {
  const url = new URL("/invite", baseUrl);
  url.searchParams.set("token", token);
  return url.href;
}

export function invitationEmailText(input: InvitationEmailInput, baseUrl: string): string {
  const expiresAt = new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(input.expiresAt));
  return [
    "Du wurdest zum Betreuungskalender eingeladen.",
    "",
    `Rolle: ${roleLabel(input.role)}`,
    `Gültig bis: ${expiresAt}`,
    "",
    "Öffne diesen Link und melde dich an. Die Einladung wird danach automatisch angenommen:",
    invitationUrl(input.token, baseUrl),
    "",
    "Wenn du diese Einladung nicht erwartet hast, ignoriere diese E-Mail.",
    "Der Link ist wie ein Passwort zu behandeln und darf nicht weitergegeben werden."
  ].join("\n");
}

function assertMailConfig(mailConfig: InvitationEmailConfig): asserts mailConfig is InvitationEmailConfig & {
  smtpHost: string;
  smtpFrom: string;
} {
  if (!invitationEmailAvailable(mailConfig)) {
    throw new InvitationEmailError(
      "mail_not_configured",
      "Einladungs-E-Mail konnte nicht gesendet werden: Mailversand ist nicht konfiguriert."
    );
  }
}

function defaultTransport(mailConfig: InvitationEmailConfig): InvitationEmailTransport {
  return nodemailer.createTransport({
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort,
    secure: mailConfig.smtpSecure,
    ...(mailConfig.smtpUser && mailConfig.smtpPassword
      ? {
          auth: {
            user: mailConfig.smtpUser,
            pass: mailConfig.smtpPassword
          }
        }
      : {})
  });
}

function sanitizeDisplayName(value?: string): string | undefined {
  const normalized = value?.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 120);
}

function escapeDisplayName(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function invitationSenderAddress(smtpFrom: string, smtpFromName?: string): string {
  const displayName = sanitizeDisplayName(smtpFromName);
  if (!displayName) return smtpFrom;
  const from = smtpFrom.trim();
  const address = from.match(/<([^<>]+)>/)?.[1]?.trim() || from;
  return `"${escapeDisplayName(displayName)}" <${address}>`;
}

export async function sendInvitationEmail(
  input: InvitationEmailInput,
  mailConfig: InvitationEmailConfig = config,
  transportFactory = defaultTransport
): Promise<void> {
  const to = input.to?.trim();
  if (!to) {
    throw new InvitationEmailError(
      "email_required",
      "Für den E-Mail-Versand ist eine Empfängeradresse erforderlich."
    );
  }
  assertMailConfig(mailConfig);
  try {
    const transport = transportFactory(mailConfig);
    await transport.sendMail({
      from: invitationSenderAddress(mailConfig.smtpFrom, mailConfig.smtpFromName),
      to,
      subject: "Einladung zum Betreuungskalender",
      text: invitationEmailText(input, mailConfig.invitationPublicBaseUrl)
    });
  } catch (error) {
    if (error instanceof InvitationEmailError) throw error;
    throw new InvitationEmailError(
      "mail_delivery_failed",
      "Einladungs-E-Mail konnte nicht gesendet werden. Bitte Mailkonfiguration prüfen oder den Code manuell weitergeben."
    );
  }
}
