// Resend's SMTP transport shares infra with Render's free-tier outbound
// network, which intermittently times out raw SMTP socket/TLS handshakes.
// Resend's HTTPS API uses the same credential (SMTP_PASS *is* the Resend
// API key) over a plain fetch, sidestepping that flakiness entirely.
const RESEND_API_KEY = process.env.SMTP_PASS;
const hasResend = Boolean(RESEND_API_KEY && process.env.SMTP_FROM);
const REQUEST_TIMEOUT_MS = 10_000;

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
      <p><a href="${ctaLink}" style="display:inline-block;padding:10px 16px;background:#1f7aec;color:white;border-radius:8px;text-decoration:none;">Open Hivemind</a></p>
      <p style="font-size:12px;color:#666;">Hivemind: where your best answer is the answer everyone else guessed too.</p>
    </div>
  `;
}

export async function sendEmail({ to, subject, intro, gameName }) {
  const appUrl = process.env.CLIENT_URL;
  const html = buildEmail(subject, intro, gameName, appUrl);

  if (!hasResend) {
    console.log('[email:mock]', { to, subject, intro });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.SMTP_FROM,
        to,
        subject,
        html,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Email send timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Message failed: ${response.status} ${body.message || response.statusText}`);
  }
}
