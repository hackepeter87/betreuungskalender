import { z } from "zod";
import { omitUndefinedValues } from "../../shared/objects.js";
import { config } from "../config.js";
import {
  createSmtpTransport,
  smtpMailAvailable,
  smtpSenderAddress,
  type SmtpMailConfig,
  type TextMailTransportFactory
} from "./mailTransport.js";

const emailAddressSchema = z.string().trim().email().max(320);

export interface NotificationEmailConfig extends SmtpMailConfig {
  notificationEmailEnabled: boolean;
  applicationBaseUrl: string;
}

export function notificationEmailAvailable(mailConfig: NotificationEmailConfig): boolean {
  return mailConfig.notificationEmailEnabled && smtpMailAvailable(mailConfig);
}

export function usableNotificationEmailAddress(value?: string | null): string | undefined {
  const parsed = emailAddressSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function notificationEmailText(applicationBaseUrl: string): string {
  const applicationUrl = new URL("/", applicationBaseUrl).href;
  return [
    "Im Betreuungskalender wartet eine neue Mitteilung.",
    "",
    "Öffne die Anwendung, um sie zu prüfen:",
    applicationUrl,
    "",
    "Diese E-Mail enthält bewusst keine fachlichen Angaben."
  ].join("\n");
}

function runtimeNotificationEmailConfig(): NotificationEmailConfig {
  return omitUndefinedValues({
    notificationEmailEnabled: config.notificationEmailEnabled,
    applicationBaseUrl: config.allowedOrigin,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpSecure: config.smtpSecure,
    smtpUser: config.smtpUser,
    smtpPassword: config.smtpPassword,
    smtpFrom: config.smtpFrom
  });
}

export function runtimeNotificationEmailAvailable(): boolean {
  return notificationEmailAvailable(runtimeNotificationEmailConfig());
}

export async function sendCareConfirmationEmail(
  recipient: string,
  mailConfig: NotificationEmailConfig = runtimeNotificationEmailConfig(),
  transportFactory: TextMailTransportFactory = createSmtpTransport
): Promise<void> {
  const to = usableNotificationEmailAddress(recipient);
  if (!notificationEmailAvailable(mailConfig) || !mailConfig.smtpFrom || !to) {
    throw new Error("Benachrichtigungs-E-Mail konnte nicht gesendet werden.");
  }
  try {
    await transportFactory(mailConfig).sendMail({
      from: smtpSenderAddress(mailConfig.smtpFrom, mailConfig.smtpFromName),
      to,
      subject: "Neue Mitteilung im Betreuungskalender",
      text: notificationEmailText(mailConfig.applicationBaseUrl)
    });
  } catch {
    throw new Error("Benachrichtigungs-E-Mail konnte nicht gesendet werden.");
  }
}
