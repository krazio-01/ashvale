import { HttpStatus, API_MESSAGES } from "@/constants/strings";
export class ResponseWrapper {
    static success<T>(data: T, message = API_MESSAGES.success): Response {
        return Response.json({ success: true, message, data });
    }

    private static error(
        message: string,
        statusCode: HttpStatus = HttpStatus.INTERNAL_ERROR
    ): Response {
        return Response.json({ success: false, message, data: null }, { status: statusCode });
    }

    static fromError(error: unknown): Response {
        if (error instanceof HttpError)
            return ResponseWrapper.error(error.message, error.statusCode);

        console.error(error);
        return ResponseWrapper.error(API_MESSAGES.somethingWentWrong, HttpStatus.INTERNAL_ERROR);
    }
}

export class HttpError extends Error {
    constructor(
        message: string,
        public statusCode: HttpStatus = HttpStatus.INTERNAL_ERROR
    ) {
        super(message);
        this.name = "HttpError";
    }
}
