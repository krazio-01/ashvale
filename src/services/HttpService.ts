import "server-only";
import axios from "axios";
import { HttpStatus } from "@/constants/strings";
import { ErrorWrapper } from "@/lib/ResponseWrapper";

const DEFAULT_TIMEOUT_MS = 15000;

const axiosInstance = axios.create({
    timeout: DEFAULT_TIMEOUT_MS,
    validateStatus: () => true,
});

export function httpGet<T>(
    url: string,
    requestHeaders?: Record<string, string>,
    timeoutMs?: number
): Promise<IHttpResponse<T>> {
    return dispatchRequest<T>("get", url, undefined, requestHeaders, timeoutMs);
}

export function httpPost<T>(
    url: string,
    body?: unknown,
    requestHeaders?: Record<string, string>,
    timeoutMs?: number
): Promise<IHttpResponse<T>> {
    return dispatchRequest<T>("post", url, body, requestHeaders, timeoutMs);
}

export function httpPut<T>(
    url: string,
    body?: unknown,
    requestHeaders?: Record<string, string>,
    timeoutMs?: number
): Promise<IHttpResponse<T>> {
    return dispatchRequest<T>("put", url, body, requestHeaders, timeoutMs);
}

export function httpPatch<T>(
    url: string,
    body?: unknown,
    requestHeaders?: Record<string, string>,
    timeoutMs?: number
): Promise<IHttpResponse<T>> {
    return dispatchRequest<T>("patch", url, body, requestHeaders, timeoutMs);
}

export function httpDelete<T>(
    url: string,
    requestHeaders?: Record<string, string>,
    timeoutMs?: number
): Promise<IHttpResponse<T>> {
    return dispatchRequest<T>("delete", url, undefined, requestHeaders, timeoutMs);
}

async function dispatchRequest<T>(
    method: HttpMethod,
    url: string,
    body: unknown,
    requestHeaders?: Record<string, string>,
    timeoutMs?: number
): Promise<IHttpResponse<T>> {
    try {
        const response = await axiosInstance.request<T>({
            method,
            url,
            data: body,
            headers: requestHeaders,
            timeout: timeoutMs,
        });

        const responseHeaders: Record<string, string> = {};

        for (const [name, value] of Object.entries(response.headers as Record<string, unknown>)) {
            if (value === undefined || value === null) continue;
            responseHeaders[name.toLowerCase()] = Array.isArray(value)
                ? value.join(", ")
                : String(value);
        }

        return {
            status: response.status,
            isSuccess: response.status >= 200 && response.status < 300,
            data: response.data,
            headers: responseHeaders,
        };
    } catch (error) {
        if (!axios.isAxiosError(error)) throw error;

        const isTimeout = error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";
        const failureReason = isTimeout
            ? `timed out after ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`
            : (error.code ?? error.message);

        throw new ErrorWrapper(
            `${method.toUpperCase()} ${url} failed: ${failureReason}`,
            HttpStatus.BAD_GATEWAY
        );
    }
}

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

interface IHttpResponse<T> {
    status: number;
    isSuccess: boolean;
    data: T;
    headers: Record<string, string>;
}
