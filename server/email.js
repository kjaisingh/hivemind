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
    })
  : null;

function buildEmail(subject, intro, gameName, ctaLink) {
  return `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #121212;">
      <h2>${subject}</h2>
      <p>${intro}</p>
      <p>You are receiving this because you are part of <strong>${gameName}</strong>.</p>
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
