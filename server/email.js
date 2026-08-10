import nodemailer from 'nodemailer';

const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const transporter = hasSmtp
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Nodemailer's default connectionTimeout is 2 minutes, and each
      // recipient in a bulk send opens its own connection — a flaky SMTP
      // host can otherwise hang an admin request for many minutes even
      // though the caller now tolerates the eventual failure.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
  : null;

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

  if (!transporter) {
    console.log('[email:mock]', { to, subject, intro });
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    html,
  });
}
