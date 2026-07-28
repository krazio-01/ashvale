import { Response } from "express";
import { HttpStatus } from "../constants/strings";

export class ResponseWrapper {
    static success<T>(res: Response, data: T, message = "Success", statusCode = HttpStatus.OK) {
        return res.status(statusCode).json({ success: true, message, data });
    }

    static error(
        res: Response,
        message: string,
        statusCode = HttpStatus.INTERNAL_ERROR,
        details?: unknown
    ) {
        return res.status(statusCode).json({ success: false, message, data: null, details });
    }
}

export class ErrorWrapper extends Error {
    constructor(
        message: string,
        public statusCode = HttpStatus.INTERNAL_ERROR,
        public details?: unknown
    ) {
        super(message);
    }
}
