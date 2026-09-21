import assert from "node:assert/strict";
import test from "node:test";
import {
  notificationEmailAvailable,
  notificationEmailText,
  sendCareConfirmationEmail,
  type NotificationEmailConfig
} from "./services/notificationEmail.js";

const configuredMail: NotificationEmailConfig = {
  notificationEmailEnabled: true,
  applicationBaseUrl: "https://calendar.example.test",
  smtpHost: "smtp.example.test",
  smtpPort: 587,
  smtpSecure: false,
  smtpFrom: "no-reply@example.test"
};

test("notification email capability is independent and fails closed", () => {
  assert.equal(notificationEmailAvailable(configuredMail), true);
  assert.equal(notificationEmailAvailable({
    ...configuredMail,
    notificationEmailEnabled: false
  }), false);
  assert.equal(notificationEmailAvailable({
    notificationEmailEnabled: true,
    applicationBaseUrl: configuredMail.applicationBaseUrl,
    smtpPort: configuredMail.smtpPort,
    smtpSecure: configuredMail.smtpSecure,
    smtpFrom: "no-reply@example.test"
  }), false);
  assert.equal(notificationEmailAvailable({
    notificationEmailEnabled: true,
    applicationBaseUrl: configuredMail.applicationBaseUrl,
    smtpHost: "smtp.example.test",
    smtpPort: configuredMail.smtpPort,
    smtpSecure: configuredMail.smtpSecure
  }), false);
});

test("notification email contains only a generic authenticated application link", () => {
  const text = notificationEmailText(configuredMail.applicationBaseUrl);

  assert.match(text, /https:\/\/calendar\.example\.test\//);
  assert.doesNotMatch(text, /kind|name|zeit|ort|notiz|konflikt|beleg|token/i);
});

test("notification email uses the hardened provider-neutral transport", async () => {
  const sent: Array<{ from: string; to: string; subject: string; text: string }> = [];

  await sendCareConfirmationEmail(
    "recipient@example.test",
    configuredMail,
    () => ({
      sendMail(message) {
        sent.push(message);
      }
    })
  );

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    from: "no-reply@example.test",
    to: "recipient@example.test",
    subject: "Neue Mitteilung im Betreuungskalender",
    text: notificationEmailText(configuredMail.applicationBaseUrl)
  });
});

test("notification email reports transport failures without leaking details", async () => {
  await assert.rejects(
    sendCareConfirmationEmail(
      "recipient@example.test",
      configuredMail,
      () => ({
        sendMail() {
          throw new Error("smtp-secret at smtp.example.test");
        }
      })
    ),
    (error) => error instanceof Error &&
      error.message === "Benachrichtigungs-E-Mail konnte nicht gesendet werden."
  );
});
