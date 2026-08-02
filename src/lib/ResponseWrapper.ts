import { HttpStatus } from "../constants/strings";

export class ResponseWrapper {
    static success<T>(
        data: T,
        message = "Success",
        statusCode: HttpStatus = HttpStatus.OK
    ): Response {
        return Response.json({ success: true, message, data }, { status: statusCode });
    }

    static error(
        message: string,
        statusCode: HttpStatus = HttpStatus.INTERNAL_ERROR,
        details?: unknown
    ): Response {
        return Response.json(
            { success: false, message, data: null, details },
            { status: statusCode }
        );
    }

    static fromError(error: unknown): Response {
        if (error instanceof ErrorWrapper)
            return ResponseWrapper.error(error.message, error.statusCode, error.details);

        console.error(error);
        return ResponseWrapper.error("Something went wrong", HttpStatus.INTERNAL_ERROR);
    }
}

export class ErrorWrapper extends Error {
    constructor(
        message: string,
        public statusCode: HttpStatus = HttpStatus.INTERNAL_ERROR,
        public details?: unknown
    ) {
        super(message);
        this.name = "ErrorWrapper";
    }
}
