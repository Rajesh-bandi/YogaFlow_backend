import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { sendExerciseReminderEmail, sendLoginThanksEmail, verifyMailConfig, sendTestEmail, sendSignupOtpEmail, sendRoutineCompletionEmail } from "./mailer";
import { getDb } from "./mongo";
import { insertAssessmentSchema, insertUserProgressSchema, insertUserSchema } from "server/schema";
import bcrypt from "bcrypt";

export async function registerRoutes(app: Express): Promise<Server> {
  // Serve yoga images statically
  app.use('/api/yoga', express.static(path.resolve(__dirname, 'yoga')));

  // Get completion rate for a user's routines for a specific day
  app.get("/api/progress/daily/:userId", async (req: express.Request, res: express.Response) => {
    try {
  const db = getDb();
  if (!db) return res.status(500).json({ message: "Database not available" });
  const { userId } = req.params;
  const date = req.query.date || new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  // Find today's recommended routine for this user
  const routineDoc = await db.collection("recommended_poses").findOne({ userId });
  const total = routineDoc?.poses?.length || 0;
  // Find all user progress for this user and date
  const progressDocs = await db.collection("user_progress").find({ userId }).toArray();
  // Only count completed poses for today
  const todayProgress = progressDocs.filter(doc => {
    const completedAt = doc.completedAt ? new Date(doc.completedAt) : null;
    if (!completedAt) return false;
    const y = completedAt.getFullYear(), m = completedAt.getMonth(), d = completedAt.getDate();
    const dateStr = typeof date === 'string' ? date : String(date);
    const [year, month, day] = dateStr.split("-").map(Number);
    return y === year && m === month - 1 && d === day;
  });
  // Aggregate all completed poses for today
  let completed = 0;
  todayProgress.forEach(doc => {
    if (Array.isArray(doc.completedPoses)) {
      completed += doc.completedPoses.length;
    }
  });
  // Cap completed to total if user did more than total
  if (completed > total) completed = total;
  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
  res.json({ date, total, completed, rate });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch completion rate", error });
    }
  });

  // Authentication routes
  // In-memory store for pending signup OTPs (usernames -> { email, code, expiresAt })
  const pendingSignups = new Map<string, { email: string; code: string; expiresAt: number }>();

  // Request a signup verification code (OTP)
  app.post("/api/auth/signup/request-code", async (req: express.Request, res: express.Response) => {
    try {
      const { username, email, purpose } = req.body;
      console.log('[DEBUG] /signup/request-code payload:', req.body);
      if (!username || !email) {
        return res.status(400).json({ error: 'Missing username or email' });
      }
      const db = getDb();
      if (!db) return res.status(500).json({ error: 'Database not available' });
      // Check if user exists
      const existingUser = await db.collection('users').findOne({ username });
      if (purpose === 'signup') {
        if (existingUser) {
          return res.status(400).json({ error: 'User already exists' });
        }
      } else if (purpose === 'password-change') {
        if (!existingUser) {
          return res.status(400).json({ error: 'User does not exist' });
        }
        // Optionally, verify email matches registered email
        if (existingUser.email !== email) {
          return res.status(400).json({ error: 'Email does not match registered email' });
        }
      }
      // Generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      // Store OTP in DB (with expiry)
      await db.collection('otps').updateOne(
        { username },
        { $set: { otp, email, expiresAt: Date.now() + 10 * 60 * 1000 } },
        { upsert: true }
      );
      console.log('[DEBUG] /signup/request-code OTP:', { username, email, otp });
      // Send OTP email
      await sendSignupOtpEmail(email, username, otp);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to send code" });
    }
  });

  // Verify code and complete registration
  app.post("/api/auth/signup/verify", async (req: express.Request, res: express.Response) => {
    try {
      const { username, password, email, code, purpose } = req.body || {};
      console.log('[DEBUG] /signup/verify payload:', req.body);
      const db = getDb();
      if (!db) return res.status(500).json({ message: "Database not available" });
      // Always use MongoDB otps collection for OTP verification
      const otpEntry = await db.collection("otps").findOne({ username, email });
      console.log('[DEBUG] /signup/verify OTP entry:', otpEntry);
      if (!otpEntry) return res.status(400).json({ message: "No OTP found for this user" });
      if (Date.now() > otpEntry.expiresAt) {
        await db.collection("otps").deleteOne({ username, email });
        return res.status(400).json({ message: "Code expired" });
      }
      if (otpEntry.otp !== code) return res.status(400).json({ message: "Invalid code" });
      // Registration or password change
      if (purpose === "password-change") {
        // Update password in users collection
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.collection("users").updateOne(
          { username },
          { $set: { password: hashedPassword } }
        );
        await db.collection("otps").deleteOne({ username, email });
        return res.json({ success: true });
      } else {
        // Registration flow
        try {
          if (db) {
            const existingMongoUser = await db.collection("users").findOne({ username });
            if (existingMongoUser) {
              return res.status(400).json({ message: "Username already taken" });
            }
          }
        } catch {}
        const existingUser = await storage.getUserByUsername(username);
        if (existingUser) return res.status(400).json({ message: "Username already taken" });
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await storage.createUser({ username, password: hashedPassword, email });
        try {
          if (db) {
            await db.collection("users").insertOne({
              id: user.id,
              username,
              password: hashedPassword,
              email: email || null,
              createdAt: new Date().toISOString(),
              emailVerifiedAt: new Date().toISOString(),
            });
          }
        } catch (e) {
          console.warn("[auth/signup/verify] Mongo mirror failed", (e as any)?.message || e);
        }
        await db.collection("otps").deleteOne({ username, email });
        const { password: _p, ...userResponse } = user;
        res.status(201).json(userResponse);
      }
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Signup verification failed" });
    }
  });
  app.post("/api/auth/register", async (req: express.Request, res: express.Response) => {
    try {
      const { username, password, email } = insertUserSchema.parse(req.body);

      // Check for existing user in Mongo (if configured)
      try {
        const db = getDb();
        if (db) {
          const existingMongoUser = await db.collection("users").findOne({ username });
          if (existingMongoUser) {
            return res.status(400).json({ message: "Username already taken" });
          }
        }
      } catch (e) {
        console.warn("[auth/register] Mongo pre-check failed", e);
      }

      // Check if user already exists (in-memory)
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already taken" });
      }

      // Hash password and create user in memory
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, password: hashedPassword, email });

      // Mirror to Mongo if configured
      try {
        const db = getDb();
        if (db) {
          await db.collection("users").insertOne({
            id: user.id,
            username,
            password: hashedPassword,
            email: email || null,
            createdAt: new Date().toISOString(),
          });
        }
      } catch (e: any) {
        if (e?.code === 11000) {
          return res.status(400).json({ message: "Username already taken" });
        }
        console.warn("[auth/register] Mongo mirror failed", e?.message || e);
      }

      const { password: _p, ...userResponse } = user;
      res.status(201).json(userResponse);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: express.Request, res: express.Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      // Find user (in-memory first), fallback to Mongo
      let user = await storage.getUserByUsername(username);
      let userFromMongo: any | null = null;
      if (!user) {
        try {
          const db = getDb();
          if (db) {
            userFromMongo = await db.collection("users").findOne({ username });
          }
        } catch (e) {
          console.warn("[auth/login] Mongo lookup failed", e);
        }
        if (!userFromMongo) {
          return res.status(401).json({ message: "Invalid credentials" });
        }
      }

      // Verify password
      const hashed = user ? user.password : (userFromMongo?.password as string | undefined);
      if (!hashed) return res.status(401).json({ message: "Invalid credentials" });
      const isValidPassword = await bcrypt.compare(password, hashed);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Build safe user response
      const { password: _ignore, ...userResponse } = user || {
        id: userFromMongo.id,
        username: userFromMongo.username,
        email: userFromMongo.email,
      };

      // Update last login in Mongo (best-effort)
      try {
        const db = getDb();
        if (db) {
          await db.collection("users").updateOne(
            { username },
            { $set: { lastLoginAt: new Date().toISOString() } }
          );
        }
      } catch (e) {
        console.warn("[auth/login] Mongo lastLoginAt update failed", e);
      }

      // Fire-and-forget thank-you email (if SMTP configured)
      if (userResponse && (userResponse as any).email) {
        console.log(`[auth] login ok, sending thanks email to ${(userResponse as any).email}`);
        sendLoginThanksEmail((userResponse as any).email, userResponse.username).catch((e) => {
          console.error("[auth] sendLoginThanksEmail failed", e);
        });
      } else {
        console.log("[auth] login ok, no email on user—skip mail");
      }

      res.json({ message: "Login successful", user: userResponse });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Login failed" });
    }
  });

  // Assessment routes
  app.post("/api/assessment", async (req: express.Request, res: express.Response) => {
    try {
      console.log("[assessment] Incoming request body:", req.body);
      const assessment = insertAssessmentSchema.parse(req.body);
      // Forward assessment to ML API
      const mlApiUrl = "https://web-production-ca02e.up.railway.app/recommend";
      console.log('[DEBUG] ML API URL:', mlApiUrl);
      console.log('[DEBUG] ML API payload:', assessment);
      const mlResponse = await fetch(mlApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assessment)
      });
      if (!mlResponse.ok) {
        throw new Error("ML API failed to return recommendations");
      }
      const recommendations = await mlResponse.json();
      // Save assessment (in-memory)
      const newAssessment = await storage.createAssessment(assessment);
      // Mirror to Mongo if configured (best-effort)
      try {
        const db = getDb();
        if (db) {
          await db.collection("recommended_poses").updateOne(
            { userId: assessment.userId || req.body.username || null },
            {
              $set: {
                poses: recommendations.recommendations || recommendations,
                createdAt: new Date().toISOString(),
              }
            },
            { upsert: true }
          );
        }
      } catch (e) {
        console.warn("[assessment] Mongo recommended_poses upsert failed", e);
      }
      // Return both assessment and recommendations
      res.json({ assessment: newAssessment, recommendations });
    } catch (error) {
      console.error("[assessment] Validation or ML error:", error);
      res.status(400).json({ message: "Invalid assessment data or ML API error", error });
    }
  });

  app.get("/api/assessment/:userId", async (req: express.Request, res: express.Response) => {
    try {
      const { userId } = req.params;
      const assessment = await storage.getAssessmentByUserId(userId);
      if (!assessment) {
        return res.status(404).json({ message: "Assessment not found" });
      }
      res.json(assessment);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch assessment", error });
    }
  });

  // Admin/maintenance endpoint to send exercise reminders to all registered users
  // In production, secure this route (auth/role). Left open here for simplicity.
  app.post("/api/notify/reminders", async (_req: express.Request, res: express.Response) => {
    try {
      // Prefer Mongo users if available, fallback to in-memory
      let users = await storage.listUsers();
      try {
        const db = getDb();
        if (db) {
          const mongoUsers = await db.collection("users").find({ email: { $exists: true, $ne: null } }).toArray();
          users = mongoUsers.map((u: any) => ({ id: u.id, username: u.username, email: u.email } as any));
        }
      } catch (e) {
        console.warn("[notify/reminders] Mongo users fetch failed", e);
      }
      let count = 0;
      await Promise.all(
        users.map(async (u) => {
          const email = (u as any).email;
          const username = (u as any).username;
          if (!email) return;
          try {
            await sendExerciseReminderEmail(email, username);
            count += 1;
          } catch {}
        })
      );
      res.json({ sent: count, total: users.length });
    } catch (error) {
      res.status(500).json({ message: "Failed to send reminders", error });
    }
  });

  // Debug: verify SMTP configuration
  app.get("/api/debug/mail", async (_req: express.Request, res: express.Response) => {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER ? "<set>" : "<missing>";
    const from = process.env.MAIL_FROM || process.env.SMTP_USER || "no-reply@example.com";
    const ver = await verifyMailConfig();
    res.json({ host: host || "<missing>", port: port || "<default 587>", user, from, verify: ver });
  });

  // Debug: send a test email (provide ?to=email)
  app.post("/api/debug/mail/test", async (req: express.Request, res: express.Response) => {
    try {
      const to = (req.query.to as string) || (req.body && req.body.to);
      if (!to) return res.status(400).json({ message: "Provide recipient via query ?to= or JSON { to }" });
      await sendTestEmail(to);
      res.json({ sent: true, to });
    } catch (e: any) {
      res.status(500).json({ sent: false, error: e?.message || String(e) });
    }
  });

  // Routine routes
  app.get("/api/routines", async (_req: express.Request, res: express.Response) => {
    try {
      const db = getDb();
      let username = null;
      // Use 'username' query param for user identification
      if (_req.query && _req.query.username) {
        username = _req.query.username;
      }
      if (db && username) {
        // MongoDB stores username in 'userId' field
        const rec = await db.collection("recommended_poses").find({ userId: username }).sort({ createdAt: -1 }).toArray();
        // Return only the latest recommended poses for this user
        if (rec.length > 0) {
          return res.json(rec[0].poses);
        } else {
          return res.json([]);
        }
      } else {
        // Fallback: return all routines (legacy)
        const routines = await storage.getRoutines();
        res.json(routines);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch routines", error });
    }
  });

  app.get("/api/routines/difficulty/:difficulty", async (req: express.Request, res: express.Response) => {
    try {
      const { difficulty } = req.params;
      const routines = await storage.getRoutinesByDifficulty(difficulty);
      res.json(routines);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch routines by difficulty", error });
    }
  });

  app.get("/api/routines/:id", async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;
      const routine = await storage.getRoutineById(id);
      if (!routine) {
        return res.status(404).json({ message: "Routine not found" });
      }
      res.json(routine);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch routine", error });
    }
  });

  // Poses routes - serve real yoga dataset
  app.get("/api/poses", async (_req: express.Request, res: express.Response) => {
    try {
      const { yogaDataset } = await import("./yoga-dataset");
      res.json(yogaDataset);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch poses", error });
    }
  });

  app.get("/api/poses/:id", async (req: express.Request, res: express.Response) => {
    try {
      const { yogaDataset } = await import("./yoga-dataset");
      const { id } = req.params;
      const pose = yogaDataset[parseInt(id)];
      if (!pose) {
        return res.status(404).json({ message: "Pose not found" });
      }
      res.json({ ...pose, id: parseInt(id) });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pose", error });
    }
  });

  app.get("/api/poses/category/:category", async (req: express.Request, res: express.Response) => {
    try {
      const { yogaDataset } = await import("./yoga-dataset");
      const { category } = req.params;
      const poses = yogaDataset.filter(pose => 
        pose.goal_category.toLowerCase() === category.toLowerCase()
      );
      res.json(poses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch poses by category", error });
    }
  });

  app.get("/api/poses/difficulty/:difficulty", async (req: express.Request, res: express.Response) => {
    try {
      const { yogaDataset } = await import("./yoga-dataset");
      const { difficulty } = req.params;
      const poses = yogaDataset.filter(pose => 
        pose.difficulty.toLowerCase() === difficulty.toLowerCase()
      );
      res.json(poses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch poses by difficulty", error });
    }
  });

  // ML Recommendations route using real yoga dataset
  app.post("/api/recommendations", async (req: express.Request, res: express.Response) => {
    try {
      // Removed local recommendation logic; recommendations should come from backend/ML API
      res.status(501).json({ error: 'Recommendation logic moved to backend/ML API.' });
    } catch (error) {
      console.error("ML Recommendation error:", error);
      res.status(500).json({ message: "Failed to generate recommendations", error });
    }
  });

  // Progress tracking routes
  app.post("/api/progress", async (req: express.Request, res: express.Response) => {
    try {
      const progress = insertUserProgressSchema.parse(req.body);
      const newProgress = await storage.createUserProgress(progress);

      // Compute streak and first-of-month based on user history
      if (!progress.userId) {
        return res.status(400).json({ message: "userId is required for progress tracking" });
      }
      const allProgress = await storage.getUserProgress(progress.userId as string);
      const dates = allProgress
        .map((p) => new Date(p.completedAt ?? ""))
        .filter((d) => !isNaN(d.getTime()))
        .sort((a, b) => a.getTime() - b.getTime());

      let streak = 0;
      if (dates.length) {
        streak = 1;
        for (let i = dates.length - 1; i > 0; i--) {
          const diffDays = Math.round(
            (dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24)
          );
          if (diffDays === 1) streak++;
          else if (diffDays === 0) continue; // multiple in same day
          else break;
        }
      }

      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const monthDates = dates.filter(
        (d) => d.getMonth() === currentMonth && d.getFullYear() === currentYear
      );
      const firstOfMonth = monthDates[0];
      const isSameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
      const isFirstOfMonth = firstOfMonth ? isSameDay(firstOfMonth, now) : false;

  // Persist to Mongo if configured
      try {
        const db = getDb();
        if (db) {
          const dayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
          await db.collection("daily_progress").updateOne(
            { userId: progress.userId, day: dayKey },
            {
              $set: {
                userId: progress.userId,
                day: dayKey,
                // new canonical timestamp field requested
                updated: new Date().toISOString(),
                // keep legacy updatedAt for compatibility
                updatedAt: new Date().toISOString(),
                // mark completion true when user logs progress
                completion: true,
              },
              $inc: { sessions: 1, totalDuration: progress.duration || 0 },
              $setOnInsert: { createdAt: new Date().toISOString() },
            },
            { upsert: true }
          );
          await db.collection("user_progress").insertOne({
            ...newProgress,
            completedPoses: progress.completedPoses || [],
          });
        }
      } catch (e) {
        console.error("Mongo persistence error", e);
      }

      // Fire-and-forget: send celebratory email if user has an email
      try {
        const user = progress.userId ? await storage.getUser(progress.userId as string) : undefined;
        const email = (user as any)?.email;
        if (email) {
          await sendRoutineCompletionEmail(email, user?.username || "Yogi", {
            routineName: progress.routineId || null,
            duration: progress.duration || null,
            streak,
            isFirstOfMonth,
          });
        }
      } catch (e) {
        console.warn("[progress] routine completion email failed", (e as any)?.message || e);
      }

      res.json({ ...newProgress, streak, isFirstOfMonth });
    } catch (error) {
      res.status(400).json({ message: "Invalid progress data", error });
    }
  });

  app.get("/api/progress/:userId", async (req: express.Request, res: express.Response) => {
    try {
      const db = getDb();
      if (!db) return res.status(500).json({ message: "Database not available" });
      const { userId } = req.params;
      const progressDocs = await db.collection("user_progress").find({ userId }).toArray();
      res.json(progressDocs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch progress", error });
    }
  });

  // Progress stats (current streak, longest streak, first-of-month flag)
  app.get("/api/progress/stats/:userId", async (req: express.Request, res: express.Response) => {
    try {
      const db = getDb();
      if (!db) return res.status(500).json({ message: "Database not available" });
      const { userId } = req.params;
      // Get all user progress from MongoDB
      const progressDocs = await db.collection("user_progress").find({ userId }).toArray();
      const dates = progressDocs
        .map((p) => new Date(p.completedAt ?? ""))
        .filter((d) => !isNaN(d.getTime()))
        .sort((a, b) => a.getTime() - b.getTime());

      // Compute current streak
      let currentStreak = 0;
      if (dates.length) {
        currentStreak = 1;
        for (let i = dates.length - 1; i > 0; i--) {
          const diffDays = Math.round(
            (dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24)
          );
          if (diffDays === 1) currentStreak++;
          else if (diffDays === 0) continue;
          else break;
        }
      }

      // Compute longest streak
      let longestStreak = 0;
      let run = 0;
      for (let i = 0; i < dates.length; i++) {
        if (i === 0) {
          run = 1;
        } else {
          const diff = Math.round(
            (dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24)
          );
          if (diff === 1) run += 1;
          else if (diff === 0) {
            // same-day entry, ignore for longest computation
          } else {
            longestStreak = Math.max(longestStreak, run);
            run = 1;
          }
        }
      }
      longestStreak = Math.max(longestStreak, run);

      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const monthDates = dates.filter(
        (d) => d.getMonth() === currentMonth && d.getFullYear() === currentYear
      );
      const firstOfMonth = monthDates[0];
      const isSameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
      const isFirstOfMonth = firstOfMonth ? isSameDay(firstOfMonth, now) : false;

      return res.json({ currentStreak, longestStreak, isFirstOfMonth });
    } catch (error) {
      res.status(500).json({ message: "Failed to compute progress stats", error });
    }
  });

  // Daily progress summaries from MongoDB (optional)
  app.get("/api/progress/daily/:userId", async (req: express.Request, res: express.Response) => {
    try {
      const { userId } = req.params;
      const days = Math.max(1, parseInt((req.query.days as string) || "30", 10));
      const db = getDb();
      if (!db) return res.status(501).json({ message: "MongoDB not configured" });

      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const docs = await db
        .collection("daily_progress")
        .find({ userId, day: { $gte: since } })
        .sort({ day: 1 })
        .toArray();
      res.json(docs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch daily progress", error });
    }
  });

  // Debug: verify Mongo connectivity and write access
  app.get("/api/debug/mongo", async (_req: express.Request, res: express.Response) => {
    try {
      const db = getDb();
      if (!db) {
        return res.status(200).json({ connected: false, reason: "No Mongo connection (set MONGO_URI)" });
      }
      const result = await db.collection("debug_ping").insertOne({ createdAt: new Date().toISOString() });
      return res.json({ connected: true, db: db.databaseName, canWrite: true, insertedId: result.insertedId });
    } catch (error) {
      return res.status(500).json({ connected: true, canWrite: false, error: (error as Error).message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
