import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST;
const port = parseInt(process.env.SMTP_PORT || "587", 10);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.MAIL_FROM || user || "no-reply@example.com";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for other ports
      auth: user && pass ? { user, pass } : undefined,
    });
  }
  return transporter;
}

export async function sendLoginThanksEmail(to: string, username: string) {
  try {
    if (!host) return; // email disabled if not configured
    const t = getTransporter();
  console.log(`[mail] sending login-thanks to ${to}`);
    await t.sendMail({
      from,
      to,
      subject: "Thanks for logging in to YogaFlow",
      text: `Hi ${username},\n\nThanks for logging in! Keep your wellness streak going—your next routine awaits.\n\nNamaste,\nYogaFlow` ,
      html: `<p>Hi <b>${username}</b>,</p><p>Thanks for logging in! Keep your wellness streak going—your next routine awaits.</p><p>Namaste,<br/>YogaFlow</p>`,
    });
  console.log(`[mail] login-thanks sent to ${to}`);
  } catch (e) {
    console.error("sendLoginThanksEmail error", e);
  }
}

export async function sendExerciseReminderEmail(to: string, username: string) {
  try {
    if (!host) return; // email disabled if not configured
    const t = getTransporter();
  console.log(`[mail] sending reminder to ${to}`);
    await t.sendMail({
      from,
      to,
      subject: "Friendly reminder: Your YogaFlow routine",
      text: `Hi ${username},\n\nTake a mindful break—complete your routine today. Your body and mind will thank you.\n\nNamaste,\nYogaFlow`,
      html: `<p>Hi <b>${username}</b>,</p><p>Take a mindful break—complete your routine today. Your body and mind will thank you.</p><p>Namaste,<br/>YogaFlow</p>`,
    });
  console.log(`[mail] reminder sent to ${to}`);
  } catch (e) {
    console.error("sendExerciseReminderEmail error", e);
  }
}

export async function sendSignupOtpEmail(to: string, username: string, code: string) {
  try {
    if (!host) return; // email disabled if not configured
    const t = getTransporter();
    console.log(`[mail] sending signup OTP to ${to}`);
    await t.sendMail({
      from,
      to,
      subject: "Your YogaFlow verification code",
      text: `Hi ${username},\n\nYour verification code is: ${code}\nIt expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
      html: `<p>Hi <b>${username}</b>,</p><p>Your verification code is:</p><p style="font-size:20px;font-weight:700;letter-spacing:3px;">${code}</p><p>This code expires in <b>10 minutes</b>.</p><p>If you didn't request this, you can ignore this email.</p>`
    });
    console.log(`[mail] signup OTP sent to ${to}`);
  } catch (e) {
    console.error("sendSignupOtpEmail error", e);
  }
}

export async function sendRoutineCompletionEmail(
  to: string,
  username: string,
  info: { routineName?: string | null; duration?: number | null; streak?: number | null; isFirstOfMonth?: boolean | null }
) {
  try {
    if (!host) return; // email disabled if not configured
    const t = getTransporter();
    const { routineName, duration, streak, isFirstOfMonth } = info || {};
    const mins = duration ? Math.round((duration as number) / 60) : null;
    const subtitle = [
      routineName ? `🧘 ${routineName}` : null,
      mins ? `⏱️ ${mins} min` : null,
      typeof streak === 'number' ? `🔥 Streak: ${streak}` : null,
      isFirstOfMonth ? '🌟 First of the month!' : null,
    ].filter(Boolean).join('  •  ');

    await t.sendMail({
      from,
      to,
      subject: `🎉 Nice work, ${username}! Routine complete` ,
      text:
        `Hey ${username}!
\nGreat job completing your routine today ✅
${subtitle ? `\n${subtitle}\n` : ''}
Keep the momentum going—your body and mind thank you 🙏
\n— YogaFlow` ,
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#111">
  <h2>🎉 Nice work, ${username}!</h2>
  <p>Great job completing your routine today <b>✅</b></p>
  ${subtitle ? `<p style="margin:12px 0; font-size:14px; color:#374151">${subtitle}</p>` : ''}
  <p>Keep the momentum going—your body and mind thank you 🙏</p>
  <p style="margin-top:20px;color:#6b7280">— YogaFlow</p>
</div>`
    });
    console.log(`[mail] routine-complete sent to ${to}`);
  } catch (e) {
    console.error("sendRoutineCompletionEmail error", e);
  }
}

// Verify transporter configuration without sending an email
export async function verifyMailConfig(): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (!host) {
      return { ok: false, reason: "SMTP_HOST not set (email disabled)" };
    }
    const t = getTransporter();
    await t.verify();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

// Send a simple test email
export async function sendTestEmail(to: string) {
  if (!host) throw new Error("SMTP not configured (missing SMTP_HOST)");
  const t = getTransporter();
  await t.sendMail({
    from,
    to,
    subject: "FlexFlow test email",
    text: "This is a test email from FlexFlow server to verify SMTP settings.",
    html: `<p>This is a <b>test email</b> from FlexFlow server to verify SMTP settings.</p>`,
  });
}
