import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { connectMongo } from "./mongo";
import { scheduleDailyReminders } from "./scheduler";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
    if (capturedJsonResponse) {
      logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
    }
    if (logLine.length > 200) {
      logLine = logLine.slice(0, 199) + "…";
    }
    log(logLine);
  });

  next();
});

function listRoutes(app: any) {
  try {
    const routes: string[] = [];
    const stack = app?._router?.stack || [];
    for (const layer of stack) {
      if (layer?.route && layer.route?.path) {
        const methods = Object.keys(layer.route.methods || {})
          .filter((m) => (layer.route.methods as any)[m])
          .map((m) => m.toUpperCase())
          .join(",");
        routes.push(`${methods} ${layer.route.path}`);
      } else if (layer?.name === "router" && layer?.handle?.stack) {
        for (const h of layer.handle.stack) {
          if (h?.route && h.route?.path) {
            const methods = Object.keys(h.route.methods || {})
              .filter((m) => (h.route.methods as any)[m])
              .map((m) => m.toUpperCase())
              .join(",");
            routes.push(`${methods} ${h.route.path}`);
          }
        }
      }
    }
    log(`[routes] ${routes.length} registered routes:`);
    routes.forEach((r) => log(`- ${r}`));
  } catch (e) {
    log(`[routes] failed to list routes: ${(e as Error).message}`);
  }
}

(async () => {
  // Optional: connect to MongoDB if env provided
  const mongoUri = process.env.MONGO_URI;
  const mongoDb = process.env.MONGO_DB || "flexflow";
  if (mongoUri) {
    try {
  const db = await connectMongo(mongoUri, mongoDb);
  log(`connected to MongoDB (${mongoDb})`);
  // Ensure index for daily progress
  await db.collection("daily_progress").createIndex({ userId: 1, day: 1 }, { unique: true });
  // Helpful indexes
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  await db.collection("user_progress").createIndex({ userId: 1, completedAt: 1 });
    } catch (e) {
      log(`failed to connect MongoDB: ${(e as Error).message}`);
    }
  }
  else {
    log("MongoDB not configured. Set MONGO_URI (and optional MONGO_DB) to enable persistence.");
  }

  // Schedule daily reminders if enabled
  scheduleDailyReminders();
  const server = await registerRoutes(app);
  // Print a quick summary of registered routes
  listRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.

  let port = parseInt(process.env.PORT || '5000', 10);
  let attempts = 0;
  const maxAttempts = 5;
  const tryListen = () => {
    server.once('error', (err: any) => {
      if (err?.code === 'EADDRINUSE' && attempts < maxAttempts) {
        attempts++;
        port += 1;
        log(`port in use, retrying on ${port}`);
        tryListen();
      } else {
        throw err;
      }
    });
    server.listen(port, () => {
      log(`serving on port ${port}`);
    });
  };
  tryListen();
})();
