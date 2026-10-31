import { useCallback, useEffect, useRef, useState } from "react";
import axios, { AxiosInstance } from "axios";
import { IErrorResponse, ISuccessResponse } from "@/types/realm";
import { API_MESSAGES } from "@/constants/strings";
import { HttpError } from "@/lib/ResponseWrapper";

const axiosInstance: AxiosInstance = axios.create({ baseURL: "/api" });

export function isRequestCancellation(caughtError: unknown): boolean {
    return axios.isCancel(caughtError);
}

function convertToErrorWrapper(caughtError: unknown): HttpError {
    if (axios.isAxiosError<IErrorResponse>(caughtError)) {
        const errorResponse = caughtError.response;
        return new HttpError(
            errorResponse?.data?.message || caughtError.message,
            errorResponse?.status
        );
    }

    if (caughtError instanceof Error) return new HttpError(caughtError.message);

    return new HttpError(API_MESSAGES.unexpectedError);
}

export function useRequest() {
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<HttpError | null>(null);

    const activeControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        return () => activeControllerRef.current?.abort();
    }, []);

    const sendRequest = useCallback(async <TResponseData>(url: string): Promise<TResponseData> => {
        activeControllerRef.current?.abort();

        const requestController = new AbortController();
        activeControllerRef.current = requestController;

        setIsPending(true);
        setError(null);

        try {
            const response = await axiosInstance.get<ISuccessResponse<TResponseData>>(url, {
                signal: requestController.signal,
            });

            return response.data.data;
        } catch (caughtError) {
            if (isRequestCancellation(caughtError)) throw caughtError;

            const requestError = convertToErrorWrapper(caughtError);
            setError(requestError);
            throw requestError;
        } finally {
            if (activeControllerRef.current === requestController) {
                activeControllerRef.current = null;
                setIsPending(false);
            }
        }
    }, []);

    return { isPending, error, sendRequest };
}
