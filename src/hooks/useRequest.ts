import { useCallback, useEffect, useRef, useState } from "react";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { IErrorResponse, ISuccessResponse } from "@/types";
import { HttpMethod } from "@/constants/strings";
import { ErrorWrapper } from "@/lib/ResponseWrapper";

const axiosInstance: AxiosInstance = axios.create({ baseURL: "/api" });

const UNEXPECTED_ERROR_MESSAGE = "An unexpected error occurred";

export function isRequestCancellation(caughtError: unknown): boolean {
    return axios.isCancel(caughtError);
}

function convertToErrorWrapper(caughtError: unknown): ErrorWrapper {
    if (axios.isAxiosError<IErrorResponse>(caughtError)) {
        const errorResponse = caughtError.response;
        return new ErrorWrapper(
            errorResponse?.data?.message || caughtError.message,
            errorResponse?.status,
            errorResponse?.data?.details
        );
    }

    if (caughtError instanceof Error) return new ErrorWrapper(caughtError.message);

    return new ErrorWrapper(UNEXPECTED_ERROR_MESSAGE);
}

export function useRequest() {
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<ErrorWrapper | null>(null);

    const activeControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        return () => activeControllerRef.current?.abort();
    }, []);

    const sendRequest = useCallback(
        async <TResponseData, TRequestBody = unknown>(
            method: HttpMethod,
            url: string,
            requestBody?: TRequestBody,
            requestConfig?: AxiosRequestConfig
        ): Promise<TResponseData> => {
            activeControllerRef.current?.abort();

            const requestController = new AbortController();
            activeControllerRef.current = requestController;

            setIsPending(true);
            setError(null);

            try {
                const response = await axiosInstance.request<ISuccessResponse<TResponseData>>({
                    ...requestConfig,
                    method,
                    url,
                    data: method === HttpMethod.Get ? undefined : requestBody,
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
        },
        []
    );

    return { isPending, error, sendRequest };
}
