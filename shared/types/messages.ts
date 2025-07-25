// shared/types/messages.ts

export type Message =
  | StrokeAddMessage
  | StrokeRemoveMessage
  | StrokeMoveMessage
  | BoardClearMessage
  | ChatMessage
  | UserJoinMessage
  | BoardSyncMessage
  | ChatSyncMessage;

export interface StrokeAddMessage {
  type: 'stroke:add';
  payload: { stroke: Stroke };
}

export interface StrokeRemoveMessage {
  type: 'stroke:remove';
  payload: { strokeId: string };
}

export interface StrokeMoveMessage {
  type: 'stroke:move';
  payload: { strokeId: string; dx: number; dy: number };
}

export interface BoardClearMessage {
  type: 'board:clear';
  payload: { userId: string };
}

export interface ChatMessage {
  type: 'chat:message';
  payload: { userId: string; username: string; message: string };
}

export interface UserJoinMessage {
  type: 'user:join';
  payload: { userId: string; username: string };
}

export interface BoardSyncMessage {
  type: 'board:sync';
  payload: { strokes: Stroke[]; users: User[] };
}

export interface ChatSyncMessage {
  type: 'chat:sync';
  payload: { chatHistory: ChatMessage['payload'][] };
}

// Supporting types
export interface Stroke {
  id: string;
  points: { x: number; y: number }[];
  color: { r: number; g: number; b: number; a: number };
  thickness: number;
  userId: string;
}

export interface User {
  userId: string;
  username: string;
}