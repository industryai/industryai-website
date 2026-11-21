/**
 * INDUSTRYAI contact notification bridge.
 *
 * Deploy as a Google Apps Script web app:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Store the shared secret in Project Settings > Script Properties:
 *   INDUSTRYAI_WEBHOOK_SECRET = <same secret configured in Supabase>
 *
 * The secret is never stored in this source file or in the public website.
 */

const INDUSTRYAI_NOTIFY_TO = "industryaisupport@gmail.com";
const INDUSTRYAI_CACHE_PREFIX = "industryai_contact_sent_";
const INDUSTRYAI_CACHE_SECONDS = 21600; // 6 hours

function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeEqual_(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) {
    mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

function cleanField_(value, maxLength, allowNewlines) {
  if (typeof value !== "string") return null;
  let result = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim();
  if (!allowNewlines) result = result.replace(/[\r\n]+/g, " ");
  if (result.length < 1 || result.length > maxLength) return null;
  return result;
}

function doPost(e) {
  let payload;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== "string") {
      return jsonOutput_({ ok: false, error: "invalid_request" });
    }
    payload = JSON.parse(e.postData.contents);
  } catch (_) {
    return jsonOutput_({ ok: false, error: "invalid_json" });
  }

  const expectedSecret = PropertiesService
    .getScriptProperties()
    .getProperty("INDUSTRYAI_WEBHOOK_SECRET");

  if (!expectedSecret || expectedSecret.length < 32 ||
      !safeEqual_(payload.secret, expectedSecret)) {
    return jsonOutput_({ ok: false, error: "unauthorized" });
  }

  const reference = cleanField_(payload.reference, 64, false);
  const name = cleanField_(payload.name, 120, false);
  const email = cleanField_(payload.email, 254, false);
  const subject = cleanField_(payload.subject, 160, false);
  const message = cleanField_(payload.message, 5000, true);

  if (!reference || !/^[0-9a-f-]{36}$/i.test(reference) ||
      !name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !subject || !message) {
    return jsonOutput_({ ok: false, error: "invalid_message" });
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = INDUSTRYAI_CACHE_PREFIX + reference;
  if (cache.get(cacheKey)) {
    return jsonOutput_({ ok: true, duplicate: true });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return jsonOutput_({ ok: false, error: "busy" });
  }

  try {
    if (cache.get(cacheKey)) {
      return jsonOutput_({ ok: true, duplicate: true });
    }

    const plainText =
      "Neue Kontaktanfrage über INDUSTRYAI\n\n" +
      "Name: " + name + "\n" +
      "E-Mail: " + email + "\n" +
      "Betreff: " + subject + "\n\n" +
      "Nachricht:\n" + message + "\n\n" +
      "Referenz: " + reference + "\n\n" +
      "Die vollständige Anfrage liegt zusätzlich im geschützten INDUSTRYAI-Admin-Posteingang.";

    GmailApp.sendEmail(
      INDUSTRYAI_NOTIFY_TO,
      ("INDUSTRYAI: " + subject).slice(0, 250),
      plainText,
      {
        name: "INDUSTRYAI Kontaktformular",
        replyTo: email
      }
    );

    cache.put(cacheKey, "sent", INDUSTRYAI_CACHE_SECONDS);
    return jsonOutput_({ ok: true, duplicate: false });
  } catch (error) {
    // Do not write message content or credentials to execution logs.
    console.error("INDUSTRYAI notification delivery failed: " +
      (error && error.message ? error.message : "unknown error"));
    return jsonOutput_({ ok: false, error: "delivery_failed" });
  } finally {
    lock.releaseLock();
  }
}

/** Manual authorization helper; run once from the Apps Script editor. */
function authorizeGmailAccess() {
  GmailApp.getAliases();
}
