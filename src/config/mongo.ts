import "server-only";
import mongoose, { Mongoose } from "mongoose";
import { env } from "@/config/env";

declare global {
    var databaseConnectionPromise: Promise<Mongoose> | undefined;
}

async function openDatabaseConnection(): Promise<Mongoose> {
    try {
        return await mongoose.connect(env.mongoUri, {
            bufferCommands: false,
            maxPoolSize: 5,
            serverSelectionTimeoutMS: 10_000,
        });
    } catch (error) {
        globalThis.databaseConnectionPromise = undefined;
        throw error;
    }
}

export async function connectToDatabase(): Promise<Mongoose> {
    if (!globalThis.databaseConnectionPromise)
        globalThis.databaseConnectionPromise = openDatabaseConnection();

    return globalThis.databaseConnectionPromise;
}
