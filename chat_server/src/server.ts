import { WebSocketServer, WebSocket } from 'ws';
import { Message, ChatMessage, BoardSyncMessage, Stroke, ChatSyncMessage } from '../../shared/types/messages';

const PORT = 9000;
const wss = new WebSocketServer({ port: PORT });

let strokes: Stroke[] = [];
let chatHistory: ChatMessage['payload'][] = [];

wss.on('connection', (ws: WebSocket) => {
  // Send board and chat history to new client
  const syncMsg: BoardSyncMessage = {
    type: 'board:sync',
    payload: {
      strokes,
      users: [] // Add user logic if you want
    }
  };
  ws.send(JSON.stringify(syncMsg));

  const chatSyncMsg: ChatSyncMessage = {
    type: 'chat:sync',
    payload: { chatHistory }
  };
  ws.send(JSON.stringify(chatSyncMsg));

  ws.on('message', (data) => {
    let msg: Message;
    try {
      msg = JSON.parse(data.toString());
      console.log('Received message:', msg); // Log every received message
    } catch {
      return;
    }

    // Handle stroke:add
    if (msg.type === 'stroke:add') {
      strokes.push(msg.payload.stroke);
      console.log('Strokes count:', strokes.length); // Log the current number of strokes
    }

    // Handle chat:message
    if (msg.type === 'chat:message') {
      chatHistory.push(msg.payload);
    }

    // Broadcast to all clients (including sender)
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  });
});

console.log(`WebSocket server running on ws://localhost:${PORT}`);