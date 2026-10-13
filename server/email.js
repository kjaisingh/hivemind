const REQUEST_TIMEOUT_MS = 10_000;

export class EmailDeliveryError extends Error {
  constructor(message, { retryable, status } = {}) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.retryable = retryable;
    this.status = status;
  }
}

function getResendApiKey() {
  return process.env.RESEND_API_KEY || process.env.SMTP_PASS;
}

export function isEmailConfigured() {
  return Boolean(getResendApiKey() && process.env.SMTP_FROM);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmail(subject, intro, gameName, ctaLink) {
  return `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #121212;">
      <h2>${escapeHtml(subject)}</h2>
      <p>${escapeHtml(intro)}</p>
      <p>You are receiving this because you are part of <strong>${escapeHtml(gameName)}</strong>.</p>
      <p><a href="${escapeHtml(ctaLink)}" style="display:inline-block;padding:10px 16px;background:#1f7aec;color:white;border-radius:8px;text-decoration:none;">Open Hivemind</a></p>
      <p style="font-size:12px;color:#666;">Hivemind: where your best answer is the answer everyone else guessed too.</p>
    </div>
  `;
}

function buildTextEmail(intro, gameName, ctaLink) {
  return `${intro}\n\nYou are receiving this because you are part of ${gameName}.\n\nOpen Hivemind: ${ctaLink}`;
}

export async function sendEmail({ to, subject, intro, gameName }) {
  const appUrl = process.env.CLIENT_URL || process.env.BASE_URL || 'http://localhost:5183';
  const html = buildEmail(subject, intro, gameName, appUrl);

  if (!isEmailConfigured()) {
    console.info('[email] Delivery skipped because Resend is not configured.');
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getResendApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.SMTP_FROM,
        to,
        subject,
        html,
        text: buildTextEmail(intro, gameName, appUrl),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new EmailDeliveryError('Email send timed out', { retryable: true });
    }
    throw new EmailDeliveryError(err.message || 'Email request failed', { retryable: true });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new EmailDeliveryError(`Message failed: ${response.status} ${body.message || response.statusText}`, {
      retryable: response.status === 429 || response.status >= 500,
      status: response.status,
    });
  }
  return true;
}
