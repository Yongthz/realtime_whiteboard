import { useEffect, useRef, useCallback } from "react";
import type { Message } from '../../../shared/types/messages';

type OnMessageHandler = (msg: Message) => void;

export const useWebSocket = (onMessage: OnMessageHandler) => {
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    ws.current = new WebSocket('ws://127.0.0.1:9000');
    ws.current.onopen = () => {
      console.log('WebSocket connected');
    };
    ws.current.onmessage = (event) => {
      try {
        const data: Message = JSON.parse(event.data);
        onMessage(data);
      } catch (err) {
        console.error('Failed to parse message', err);
      }
    };
    ws.current.onclose = () => {
      console.log('WebSocket disconnected');
    };
    return () => {
      ws.current?.close();
    };
  }, [onMessage]); // <--- THIS IS THE CRITICAL PART

  const send = useCallback((msg: Message) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  return { send };
};



