export enum HttpStatus {
    OK = 200,
    CREATED = 201,
    ACCEPTED = 202,
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    CONFLICT = 409,
    UNPROCESSABLE_ENTITY = 422,
    TOO_MANY_REQUESTS = 429,
    INTERNAL_ERROR = 500,
    BAD_GATEWAY = 502,
}

export enum HttpMethod {
    Get = "GET",
    Post = "POST",
    Put = "PUT",
    Patch = "PATCH",
    Delete = "DELETE",
}

export const APP_TEXT = {
    title: "Ashvale",
    description:
        "Explore any GitHub repository as a procedurally generated realm — its structure becomes terrain, its history becomes enemies.",
};

export const LANDING_TEXT = {
    orbitHint: "drag or scroll to orbit",
};

export const API_MESSAGES = {
    success: "Success",
    realmForged: "Realm forged",
    featuredRealmsListed: "Featured realms listed",
    somethingWentWrong: "Something went wrong",
    unexpectedError: "An unexpected error occurred",
};

export const ERRORS = {
    missingEnvironmentVariable: (key: string) => `Missing required environment variable: ${key}`,
};

export const LOG_MESSAGES = {
    subtreeUnavailable: (path: string) => `subtree unavailable for ${path}:`,
};
