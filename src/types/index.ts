export interface ISuccessResponse<TData> {
    success: true;
    message: string;
    data: TData;
}

export interface IErrorResponse {
    success: false;
    message: string;
    data: null;
    details?: unknown;
}
