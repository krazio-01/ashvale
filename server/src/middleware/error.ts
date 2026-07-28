import { Request, Response, NextFunction } from "express";
import { HttpStatus } from "../constants/strings";
import { ErrorWrapper, ResponseWrapper } from "../lib/ResponseWrapper";

export function notFound(req: Request, _res: Response, next: NextFunction) {
    next(
        new ErrorWrapper(`Route not found: ${req.method} ${req.originalUrl}`, HttpStatus.NOT_FOUND)
    );
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
    if (err instanceof ErrorWrapper) {
        ResponseWrapper.error(res, err.message, err.statusCode, err.details);
        return;
    }

    console.error(`${req.method} ${req.originalUrl}`, err);
    ResponseWrapper.error(res, "Internal server error");
}
