import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const ALLOWED_ORIGIN = "https://industryai.github.io";
const EXPECTED_HOSTNAME = "industryai.github.io";
const EXPECTED_ACTION = "contact_message_submit";
const MAX_BODY_BYTES = 8_000;
// Public Google Apps Script deployment URL; the webhook secret remains in Supabase Secrets.
const INDUSTRYAI_EMAIL_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwzHdKWFtosX1kk8HNOxeJvXzOjVXyh7l8hr7_a2AFGZzWPe4saKM_rkM2XJG0hIfl7/exec";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "apikey, content-type, x-industryai-email-test-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim();
  return cleaned.length > maxLength ? null : cleaned;
}

function secureEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    forwarded ||
    "";
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const publishableKey = publishableKeys.default ?? "";
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const secretKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const adminClient = supabaseUrl && secretKey
  ? createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

Deno.serve(async (req: Request) => {
  const requestPath = new URL(req.url).pathname;
  const isNotificationTestRequest = requestPath.endsWith("/test-notification");
  const origin = req.headers.get("origin") ?? "";
  if (origin !== ALLOWED_ORIGIN && !isNotificationTestRequest) {
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "method_not_allowed" }, 405);
  }

  if (!publishableKey || req.headers.get("apikey") !== publishableKey) {
    return jsonResponse({ success: false, error: "invalid_api_key" }, 401);
  }

  // Protected operational self-test. It sends one synthetic notification only;
  // it does not write to contact_messages and never returns secret values.
  if (isNotificationTestRequest) {
    const notificationUrl = INDUSTRYAI_EMAIL_WEBHOOK_URL;
    const notificationSecret = Deno.env.get("INDUSTRYAI_EMAIL_WEBHOOK_SECRET") ?? "";
    const suppliedTestSecret = req.headers.get("x-industryai-email-test-secret") ?? "";

    if (
      notificationSecret.length < 32 ||
      !secureEquals(suppliedTestSecret, notificationSecret)
    ) {
      return jsonResponse({ success: false, error: "test_not_authorized" }, 403);
    }

    let validNotificationUrl = false;
    try {
      const parsedNotificationUrl = new URL(notificationUrl);
      validNotificationUrl =
        parsedNotificationUrl.protocol === "https:" &&
        parsedNotificationUrl.hostname === "script.google.com" &&
        parsedNotificationUrl.pathname.startsWith("/macros/s/") &&
        parsedNotificationUrl.pathname.endsWith("/exec");
    } catch {
      validNotificationUrl = false;
    }
    if (!validNotificationUrl) {
      return jsonResponse({ success: false, error: "notification_url_not_configured" }, 503);
    }

    const testReference = crypto.randomUUID();
    try {
      const response = await fetch(notificationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: notificationSecret,
          reference: testReference,
          name: "INDUSTRYAI Systemtest",
          email: "industryaisupport@gmail.com",
          subject: "INDUSTRYAI – Test der E-Mail-Benachrichtigung",
          message: "Diese technische Testnachricht prüft die Verbindung zwischen Supabase, Google Apps Script und Gmail. Es wurde kein Kontaktformular-Datensatz angelegt.",
        }),
        signal: AbortSignal.timeout(15000),
      });
      const responseText = await response.text();
      let result: { ok?: boolean; error?: string; duplicate?: boolean } | null = null;
      try {
        result = JSON.parse(responseText);
      } catch {
        result = null;
      }
      if (!response.ok || result?.ok !== true) {
        const safeError = typeof result?.error === "string" &&
          /^[a-z_]{2,50}$/.test(result.error)
          ? result.error
          : "non_json_or_unexpected_google_response";
        console.error(
          "INDUSTRYAI notification self-test failed:",
          JSON.stringify({
            google_http_status: response.status,
            google_content_type: response.headers.get("content-type") ?? "unknown",
            google_error: safeError,
          }),
        );
        return jsonResponse({
          success: false,
          error: "notification_delivery_failed",
          diagnostic: {
            google_http_status: response.status,
            google_content_type: response.headers.get("content-type") ?? "unknown",
            google_error: safeError,
          },
        }, 502);
      }
      return jsonResponse({ success: true, notification: "confirmed" }, 200);
    } catch {
      console.error("INDUSTRYAI notification self-test request failed.");
      return jsonResponse({ success: false, error: "notification_request_failed" }, 502);
    }
  }

  const turnstileSecret = Deno.env.get("CLOUDFLARE_TURNSTILE_SECRET_KEY") ?? "";
  const rateLimitSecret = Deno.env.get("INDUSTRYAI_RATE_LIMIT_HMAC_SECRET") ?? "";
  if (!adminClient || !turnstileSecret || rateLimitSecret.length < 32) {
    console.error("Contact protection is not fully configured.");
    return jsonResponse({ success: false, error: "submission_protection_not_configured" }, 503);
  }

  const ip = getClientIp(req);
  if (!ip) {
    return jsonResponse({ success: false, error: "request_could_not_be_verified" }, 400);
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return jsonResponse({ success: false, error: "invalid_request" }, 400);
  }
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return jsonResponse({ success: false, error: "request_too_large" }, 413);
  }

  let input: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    input = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ success: false, error: "invalid_request" }, 400);
  }

  // Simple hidden honeypot for low-effort automated submissions.
  const honeypot = cleanText(input.company_website, 200);
  if (honeypot === null || honeypot.length > 0) {
    return jsonResponse({ success: true }, 202);
  }

  const name = cleanText(input.name, 120);
  const emailValue = cleanText(input.email, 254);
  const subject = cleanText(input.subject, 160);
  const message = cleanText(input.message, 5000);
  const token = cleanText(input.turnstile_token, 4096);

  if ([name, emailValue, subject, message].some((value) => value === null)) {
    return jsonResponse({ success: false, error: "field_too_long" }, 400);
  }

  const normalizedEmail = (emailValue ?? "").toLowerCase();
  if (
    (name ?? "").length < 2 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    (subject ?? "").length < 2 ||
    (message ?? "").length < 10 ||
    !token ||
    token.length < 10
  ) {
    return jsonResponse({ success: false, error: "invalid_form_data" }, 400);
  }

  // Rate limits use keyed hashes. No raw IP address is stored in the rate-limit table.
  const ipHash = await hmacHex(rateLimitSecret, "ip:" + ip);
  const { data: ipAllowed, error: ipRateError } = await adminClient
    .rpc("consume_company_profile_rate_limit", {
      p_key_hash: ipHash,
      p_limit: 5,
      p_window_seconds: 3600,
    });
  if (ipRateError || ipAllowed !== true) {
    if (ipRateError) console.error("Contact IP rate-limit check failed:", ipRateError.message);
    return jsonResponse(
      { success: false, error: "rate_limit_exceeded" },
      ipRateError ? 503 : 429,
    );
  }

  const verificationBody = new FormData();
  verificationBody.append("secret", turnstileSecret);
  verificationBody.append("response", token);
  verificationBody.append("remoteip", ip);

  let verification: { success?: boolean; hostname?: string; action?: string };
  try {
    const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: verificationBody,
    });
    if (!result.ok) throw new Error("Turnstile verification endpoint unavailable");
    verification = await result.json();
  } catch (error) {
    console.error("Contact Turnstile verification failed:", error);
    return jsonResponse({ success: false, error: "captcha_verification_unavailable" }, 503);
  }

  if (
    verification.success !== true ||
    verification.hostname !== EXPECTED_HOSTNAME ||
    verification.action !== EXPECTED_ACTION
  ) {
    return jsonResponse({ success: false, error: "captcha_verification_failed" }, 403);
  }

  const emailHash = await hmacHex(rateLimitSecret, "email:" + normalizedEmail);
  const { data: emailAllowed, error: emailRateError } = await adminClient
    .rpc("consume_company_profile_rate_limit", {
      p_key_hash: emailHash,
      p_limit: 3,
      p_window_seconds: 86400,
    });
  if (emailRateError || emailAllowed !== true) {
    if (emailRateError) console.error("Contact email rate-limit check failed:", emailRateError.message);
    return jsonResponse(
      { success: false, error: "rate_limit_exceeded" },
      emailRateError ? 503 : 429,
    );
  }

  const { data: inserted, error: insertError } = await adminClient
    .from("contact_messages")
    .insert({
      name: name,
      email: normalizedEmail,
      subject: subject,
      message: message,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    if (insertError) console.error("Contact message insert failed:", insertError.message);
    return jsonResponse({ success: false, error: "submission_failed" }, 500);
  }

  // Optional Gmail notification bridge. The contact record is already safely
  // stored above; a notification failure must never discard the visitor's request.
  const notificationUrl = INDUSTRYAI_EMAIL_WEBHOOK_URL;
  const notificationSecret = Deno.env.get("INDUSTRYAI_EMAIL_WEBHOOK_SECRET") ?? "";
  if (notificationUrl && notificationSecret.length >= 32) {
    let validNotificationUrl = false;
    try {
      const parsedNotificationUrl = new URL(notificationUrl);
      validNotificationUrl =
        parsedNotificationUrl.protocol === "https:" &&
        parsedNotificationUrl.hostname === "script.google.com" &&
        parsedNotificationUrl.pathname.startsWith("/macros/s/") &&
        parsedNotificationUrl.pathname.endsWith("/exec");
    } catch {
      validNotificationUrl = false;
    }

    if (validNotificationUrl) {
      try {
        const notificationResponse = await fetch(notificationUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: notificationSecret,
            reference: inserted.id,
            name: name,
            email: normalizedEmail,
            subject: subject,
            message: message,
          }),
          signal: AbortSignal.timeout(10000),
        });
        const notificationResult = await notificationResponse.json().catch(() => null);
        if (!notificationResponse.ok || notificationResult?.ok !== true) {
          console.error("Contact email notification was not confirmed.");
        }
      } catch {
        console.error("Contact email notification request failed.");
      }
    } else {
      console.error("Contact email notification URL is invalid.");
    }
  } else {
    console.warn("Contact email notification is not configured; request remains in admin inbox.");
  }

  return jsonResponse({ success: true, reference: inserted.id }, 201);
});
