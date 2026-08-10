import { useCallback, useEffect, useRef, useState } from "react";
import axios, { AxiosInstance, AxiosRequestConfig, GenericAbortSignal } from "axios";
import { IErrorResponse, ISuccessResponse } from "@/types";
import { HttpMethod } from "@/constants/strings";
import { ErrorWrapper } from "@/lib/ResponseWrapper";

const axiosInstance: AxiosInstance = axios.create({ baseURL: "/api" });

const UNEXPECTED_ERROR_MESSAGE = "An unexpected error occurred";

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

function abortRequestWhenCallerAborts(
    requestController: AbortController,
    callerSignal?: GenericAbortSignal
) {
    if (!callerSignal) return;

    if (callerSignal.aborted) {
        requestController.abort();
        return;
    }

    callerSignal.addEventListener?.("abort", () => requestController.abort(), { once: true });
}

export function useRequest() {
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<ErrorWrapper | null>(null);

    const activeRequestsRef = useRef<Set<AbortController>>(new Set());

    useEffect(() => {
        const activeRequests = activeRequestsRef.current;
        return () => {
            for (const controller of activeRequests) controller.abort();
            activeRequests.clear();
        };
    }, []);

    const sendRequest = useCallback(
        async <TResponseData, TRequestBody = unknown>(
            method: HttpMethod,
            url: string,
            requestBody?: TRequestBody,
            requestConfig?: AxiosRequestConfig
        ): Promise<TResponseData> => {
            const activeRequests = activeRequestsRef.current;
            const requestController = new AbortController();

            abortRequestWhenCallerAborts(requestController, requestConfig?.signal);

            activeRequests.add(requestController);
            setIsPending(true);
            setError(null);

            try {
                const response = await axiosInstance.request<
                    ISuccessResponse<TResponseData>
                >({
                    ...requestConfig,
                    method,
                    url,
                    data: method === HttpMethod.Get ? undefined : requestBody,
                    signal: requestController.signal,
                });

                return response.data.data;
            } catch (caughtError) {
                if (axios.isCancel(caughtError)) throw caughtError;

                const requestError = convertToErrorWrapper(caughtError);
                setError(requestError);
                throw requestError;
            } finally {
                activeRequests.delete(requestController);
                if (activeRequests.size === 0) setIsPending(false);
            }
        },
        []
    );

    return { isPending, error, sendRequest };
}
