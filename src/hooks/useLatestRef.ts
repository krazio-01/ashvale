"use client";
import { useEffect, useRef, type RefObject } from "react";

export function useLatestRef<Value>(value: Value): RefObject<Value> {
    const latestRef = useRef(value);

    useEffect(() => {
        latestRef.current = value;
    });

    return latestRef;
}
