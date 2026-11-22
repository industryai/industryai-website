/**
 * Run once from the Apps Script editor to test the complete path:
 * Apps Script -> Supabase Edge Function -> Apps Script -> Gmail.
 *
 * It sends one clearly-labelled test notification to the configured support
 * mailbox. It does not create a contact_messages database row.
 */
function testIndustryAIEmailNotification() {
  const secret = PropertiesService
    .getScriptProperties()
    .getProperty("INDUSTRYAI_WEBHOOK_SECRET");

  if (!secret || secret.length < 32) {
    throw new Error("INDUSTRYAI_WEBHOOK_SECRET is missing or too short.");
  }

  const endpoint =
    "https://aldeuchbhvljdhuaossw.supabase.co/functions/v1/contact-message-submit/test-notification";

  const response = UrlFetchApp.fetch(endpoint, {
    method: "post",
    contentType: "application/json",
    headers: {
      "apikey": "sb_publishable_fI1gwvwvbnXAxX4e-CBYJQ_LWuV1sWN",
      "x-industryai-email-test-secret": secret
    },
    payload: JSON.stringify({ test: true }),
    muteHttpExceptions: true,
    followRedirects: true
  });

  const status = response.getResponseCode();
  const body = response.getContentText();

  Logger.log("HTTP " + status);
  Logger.log(body);

  if (status !== 200) {
    throw new Error("INDUSTRYAI notification test failed (HTTP " + status + ").");
  }

  let result;
  try {
    result = JSON.parse(body);
  } catch (_) {
    throw new Error("Notification test returned a non-JSON response.");
  }

  if (result.success !== true || result.notification !== "confirmed") {
    throw new Error("Supabase did not confirm the notification test.");
  }

  Logger.log("INDUSTRYAI notification test confirmed.");
}
