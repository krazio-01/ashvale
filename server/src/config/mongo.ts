import mongoose from "mongoose";
import { env } from "./env";

export async function connectMongo(): Promise<void> {
    mongoose.connection.on("error", (error) => console.error("database error:", error.message));
    mongoose.connection.on("disconnected", () => console.warn("database disconnected"));

    await mongoose.connect(env.MONGO_URI);
    console.log(`database connected: ${mongoose.connection.name}`);
}
