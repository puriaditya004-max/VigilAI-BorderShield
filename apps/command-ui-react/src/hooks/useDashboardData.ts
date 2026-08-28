import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDashboardData, operatorHeaders } from "../api";
import type { DashboardData, OperatorSession } from "../types";

export type ConnectionState = "loading" | "live" | "polling" | "offline";

const emptyData: DashboardData = {
  health: { status: "unknown", service: "control-api", time: "" },
  cameras: [],
  zones: [],
  incidents: [],
  evidence: [],
  audit: [],
  metrics: {}
};

const LIVE_REFRESH_EVENTS = new Set([
  "incident.created",
  "incident.acknowledged",
  "incident.escalated",
  "camera.health",
  "camera.reconnected",
  "evidence.verified"
]);

export function useDashboardData(operator: OperatorSession) {
  const [data, setData] = useState<DashboardData>(emptyData);
  const [connectionState, setConnectionState] = useState<ConnectionState>("loading");
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchDashboardData(operator);
      if (cancelled.current) return;
      setData(next);
      setError(null);
      setConnectionState((current) => current === "live" ? "live" : "polling");
    } catch (err) {
      if (cancelled.current) return;
      setError(err instanceof Error ? err.message : "Control API unavailable");
      setConnectionState("offline");
    }
  }, [operator]);

  useEffect(() => {
    cancelled.current = false;
    setConnectionState("loading");
    refresh();

    const pollTimer = window.setInterval(refresh, 30000);
    const abortController = new AbortController();
    let reconnectTimer = 0;

    function scheduleReconnect() {
      if (cancelled.current) return;
      setConnectionState((current) => current === "offline" ? "offline" : "polling");
      reconnectTimer = window.setTimeout(connectEventStream, 5000);
    }

    async function connectEventStream() {
      try {
        const response = await fetch("/api/events", {
          headers: operatorHeaders(operator),
          signal: abortController.signal
        });
        if (!response.ok || !response.body) throw new Error(`/api/events ${response.status}`);

        setConnectionState("live");
        setError(null);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled.current) {
          const { done, value } = await reader.read();
          if (done) throw new Error("event stream closed");
          buffer += decoder.decode(value, { stream: true });
          const parsed = consumeEventMessages(buffer);
          buffer = parsed.remainder;
          if (parsed.events.some((eventName) => LIVE_REFRESH_EVENTS.has(eventName))) {
            await refresh();
            setConnectionState("live");
          }
        }
      } catch (err) {
        if (abortController.signal.aborted || cancelled.current) return;
        setError(err instanceof Error ? err.message : "event stream unavailable");
        scheduleReconnect();
      }
    }

    connectEventStream();

    return () => {
      cancelled.current = true;
      abortController.abort();
      window.clearInterval(pollTimer);
      window.clearTimeout(reconnectTimer);
    };
  }, [operator, refresh]);

  return { data, operator, connectionState, error, refresh, setData };
}

function consumeEventMessages(buffer: string) {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() || "";
  const events = parts
    .map((message) => message.split("\n").find((line) => line.startsWith("event: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => line.slice("event: ".length));
  return { events, remainder };
}
