import { type User, type InsertUser, type Assessment, type InsertAssessment, type Routine, type InsertRoutine, type UserProgress, type InsertUserProgress } from "./schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  listUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  
  createAssessment(assessment: InsertAssessment): Promise<Assessment>;
  getAssessmentByUserId(userId: string): Promise<Assessment | undefined>;
  
  getRoutines(): Promise<Routine[]>;
  getRoutinesByDifficulty(difficulty: string): Promise<Routine[]>;
  getRoutineById(id: string): Promise<Routine | undefined>;
  createRoutine(routine: InsertRoutine): Promise<Routine>;
  
  createUserProgress(progress: InsertUserProgress): Promise<UserProgress>;
  getUserProgress(userId: string): Promise<UserProgress[]>;
  getUserProgressByRoutine(userId: string, routineId: string): Promise<UserProgress[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private assessments: Map<string, Assessment>;
  private routines: Map<string, Routine>;
  private userProgress: Map<string, UserProgress>;

  constructor() {
    this.users = new Map();
    this.assessments = new Map();
    this.routines = new Map();
    this.userProgress = new Map();
    
    // Initialize with sample routines
    this.initializeRoutines();
  }

  private initializeRoutines() {
    const sampleRoutines: InsertRoutine[] = [
      {
        name: "Morning Flow",
        description: "Start your day with gentle stretches and energizing poses. Perfect for building flexibility and setting positive intentions.",
        duration: 15,
        difficulty: "beginner",
        category: "morning",
        poses: [
          { name: "Mountain Pose", duration: 30, instructions: "Stand tall with feet hip-width apart" },
          { name: "Sun Salutation A", duration: 120, instructions: "Flow through the classic sun salutation sequence" },
          { name: "Downward Dog", duration: 60, instructions: "Press hands down, lift hips up" },
          { name: "Child's Pose", duration: 60, instructions: "Rest in child's pose to center yourself" }
        ]
      },
      {
        name: "Strength Builder",
        description: "Build core strength and muscle tone with challenging poses that push your limits while maintaining proper alignment.",
        duration: 25,
        difficulty: "intermediate",
        category: "strength",
        poses: [
          { name: "Warrior I", duration: 45, instructions: "Strong standing pose with arms raised" },
          { name: "Warrior II", duration: 45, instructions: "Open hip warrior with arms extended" },
          { name: "Side Plank", duration: 30, instructions: "Balance on one arm, stack feet" },
          { name: "Crow Pose", duration: 30, instructions: "Arm balance with knees on upper arms" },
          { name: "Boat Pose", duration: 45, instructions: "V-shape balance pose for core strength" }
        ]
      },
      {
        name: "Evening Calm",
        description: "Wind down with restorative poses and breathing exercises designed to reduce stress and prepare for restful sleep.",
        duration: 20,
        difficulty: "all levels",
        category: "evening",
        poses: [
          { name: "Cat-Cow", duration: 60, instructions: "Gentle spinal movement to release tension" },
          { name: "Seated Forward Fold", duration: 90, instructions: "Calm the nervous system with forward bending" },
          { name: "Legs Up the Wall", duration: 180, instructions: "Restorative inversion for relaxation" },
          { name: "Savasana", duration: 300, instructions: "Complete rest and integration" }
        ]
      }
    ];

    sampleRoutines.forEach(routine => {
      const id = randomUUID();
      this.routines.set(id, { ...routine, id, createdAt: new Date().toISOString() });
    });
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async listUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id } as User;
    this.users.set(id, user);
    return user;
  }

  async createAssessment(assessment: InsertAssessment): Promise<Assessment> {
    const id = randomUUID();
    const newAssessment: Assessment = { 
      ...assessment,
      userId: assessment.userId || null,
      healthConditions: assessment.healthConditions || null,
      id,
      createdAt: new Date().toISOString()
    };
    this.assessments.set(id, newAssessment);
    return newAssessment;
  }

  async getAssessmentByUserId(userId: string): Promise<Assessment | undefined> {
    return Array.from(this.assessments.values()).find(
      (assessment) => assessment.userId === userId
    );
  }

  async getRoutines(): Promise<Routine[]> {
    return Array.from(this.routines.values());
  }

  async getRoutinesByDifficulty(difficulty: string): Promise<Routine[]> {
    return Array.from(this.routines.values()).filter(
      routine => routine.difficulty === difficulty
    );
  }

  async getRoutineById(id: string): Promise<Routine | undefined> {
    return this.routines.get(id);
  }

  async createRoutine(routine: InsertRoutine): Promise<Routine> {
    const id = randomUUID();
    const newRoutine: Routine = { 
      ...routine, 
      id,
      createdAt: new Date().toISOString()
    };
    this.routines.set(id, newRoutine);
    return newRoutine;
  }

  async createUserProgress(progress: InsertUserProgress): Promise<UserProgress> {
    const id = randomUUID();
    const newProgress: UserProgress = { 
      ...progress,
      userId: progress.userId || null,
      routineId: progress.routineId || null,
      rating: progress.rating || null,
      completedPoses: progress.completedPoses ?? null,
      id,
      completedAt: new Date().toISOString()
    };
    this.userProgress.set(id, newProgress);
    return newProgress;
  }

  async getUserProgress(userId: string): Promise<UserProgress[]> {
    return Array.from(this.userProgress.values()).filter(
      progress => progress.userId === userId
    );
  }

  async getUserProgressByRoutine(userId: string, routineId: string): Promise<UserProgress[]> {
    return Array.from(this.userProgress.values()).filter(
      progress => progress.userId === userId && progress.routineId === routineId
    );
  }
}

export const storage = new MemStorage();
