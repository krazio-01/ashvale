import app from "./app";
import { env } from "./config/env";
import { connectMongo } from "./config/mongo";

async function startServer(): Promise<void> {
    await connectMongo();

    app.listen(env.port, () => {
        console.log(`Server running on port ${env.port} [${env.nodeEnv}]`);
    });
}

startServer();
