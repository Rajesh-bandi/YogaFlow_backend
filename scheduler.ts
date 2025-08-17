import cron from "node-cron";
import { getDb } from "./mongo";
import { storage } from "./storage";
import { sendExerciseReminderEmail } from "./mailer";

function getLocalDayString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function scheduleDailyReminders() {
  const enabled = process.env.CRON_ENABLED === "1" || process.env.CRON_ENABLED === "true";
  if (!enabled) {
    console.log("[cron] disabled; set CRON_ENABLED=1 to enable daily reminders");
    return;
  }

  const expr = process.env.CRON_TIME || "0 9 * * *"; // 9:00 every day
  const tz = process.env.TZ; // optional, e.g., "Asia/Kolkata"

  cron.schedule(
    expr,
    async () => {
      try {
        const db = getDb();
        if (!db) {
          console.log("[cron] MongoDB not configured; skip reminders");
          return;
        }

        const users = await storage.listUsers();
        const today = getLocalDayString();
        let sent = 0;

        for (const u of users) {
          const email = (u as any).email;
          if (!email) continue;

          // Has user completed today?
          const existing = await db.collection("daily_progress").findOne({ userId: u.id, day: today });
          if (existing) continue;

          try {
            await sendExerciseReminderEmail(email, u.username);
            sent++;
          } catch (e) {
            console.error("[cron] reminder failed", e);
          }
        }
        console.log(`[cron] reminders sent: ${sent}/${users.length}`);
      } catch (e) {
        console.error("[cron] job error", e);
      }
    },
    tz ? { timezone: tz } : undefined
  );

  console.log(`[cron] scheduled daily reminders at '${expr}'${tz ? ` (TZ=${tz})` : ""}`);
}
