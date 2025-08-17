import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
});

export const assessments = pgTable("assessments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  ageGroup: text("age_group").notNull(),
  experience: text("experience").notNull(),
  goals: text("goals").array().notNull(),
  timeAvailable: text("time_available").notNull(),
  healthConditions: text("health_conditions").array(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const routines = pgTable("routines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(),
  duration: integer("duration").notNull(),
  difficulty: text("difficulty").notNull(),
  poses: jsonb("poses").notNull(),
  category: text("category").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const userProgress = pgTable("user_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  routineId: varchar("routine_id"),
  completedAt: text("completed_at").default(sql`CURRENT_TIMESTAMP`),
  duration: integer("duration").notNull(),
  rating: integer("rating"),
  completedPoses: jsonb("completed_poses"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
});

export const insertAssessmentSchema = createInsertSchema(assessments).omit({
  id: true,
  createdAt: true,
});

export const insertRoutineSchema = createInsertSchema(routines).omit({
  id: true,
  createdAt: true,
});

export const insertUserProgressSchema = createInsertSchema(userProgress).omit({
  id: true,
  completedAt: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Assessment = typeof assessments.$inferSelect;
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;
export type Routine = typeof routines.$inferSelect;
export type InsertRoutine = z.infer<typeof insertRoutineSchema>;
export type UserProgress = typeof userProgress.$inferSelect;
export type InsertUserProgress = z.infer<typeof insertUserProgressSchema>;
