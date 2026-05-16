import mongoose from "mongoose";
import { getEnv } from "./env";

let connecting: Promise<typeof mongoose> | null = null;

/**
 * Idempotently connect to MongoDB. Safe to call from any module/route.
 * Reuses the connection across hot-reloads in dev.
 */
export async function connectMongo(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (connecting) return connecting;
  const { MONGODB_URI } = getEnv();
  connecting = mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export { mongoose };
