import express from "express";
import cors from "cors";
import { env } from "./config/env";
import { notFound, errorHandler } from "./middleware/error";

const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.use(notFound);
app.use(errorHandler);

export default app;
