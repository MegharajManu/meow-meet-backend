require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Get the frontend URL from environment variable or default to localhost
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

app.use(cors({
  origin: FRONTEND_URL,
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
}));

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 120000,
  pingInterval: 30000,
  transports: ['websocket', 'polling'],
});

// Track rooms and their occupants
let roomCounter = 0;
const roomPrefix = 'chat-room-';

// Function to find or create a room for a user
const assignRoomToUser = (socket) => {
  let assignedRoom = null;
  // First, try to find an existing room with 1 user
  for (let i = 1; i <= roomCounter + 1; i++) {
    const roomId = `${roomPrefix}${i}`;
    const room = io.sockets.adapter.rooms.get(roomId);
    const numClients = room ? room.size : 0;

    if (numClients === 1) {
      assignedRoom = roomId;
      break;
    }
  }

  // If no room with 1 user is found, create a new room
  if (!assignedRoom) {
    roomCounter++;
    assignedRoom = `${roomPrefix}${roomCounter}`;
  }

  // Join the assigned room
  socket.join(assignedRoom);
  const room = io.sockets.adapter.rooms.get(assignedRoom);
  const numClients = room ? room.size : 0;
  console.log(`User ${socket.id} joined room ${assignedRoom}, clients: ${numClients}`);

  socket.roomId = assignedRoom;
  const isInitiator = numClients === 1;

  if (numClients > 2) {
    socket.emit('error', { message: 'Room is full' });
    socket.leave(assignedRoom);
    socket.roomId = null;
    return;
  }

  // Notify the user of their room assignment
  socket.emit('joined-room', {
    roomId: assignedRoom,
    initiator: isInitiator,
    userId: socket.id,
    numClients,
  });

  if (numClients === 2) {
    const userIds = Array.from(room);
    io.to(assignedRoom).emit('start-chat', {
      roomId: assignedRoom,
      userIds,
    });
  }
};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Assign the user to a room on initial connection
  assignRoomToUser(socket);

  socket.on('signal', ({ data, roomId, from }) => {
    if (!roomId || !from) {
      socket.emit('error', { message: 'Invalid signal data' });
      return;
    }

    console.log(`Signal from ${from} to room ${roomId}, type: ${data.type || 'candidate'}`);
    socket.to(roomId).emit('signal', { data, from });
  });

  socket.on('next-partner', () => {
    console.log(`User ${socket.id} requested a new partner`);
    const currentRoom = socket.roomId;

    if (currentRoom) {
      // Notify the current partner that the user left
      socket.to(currentRoom).emit('peer-disconnected', {
        userId: socket.id,
        reason: 'User requested a new partner',
      });

      // Leave the current room
      socket.leave(currentRoom);
      socket.roomId = null;

      // Assign the user to a new room
      assignRoomToUser(socket);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`User ${socket.id} disconnected: ${reason}`);
    if (socket.roomId) {
      socket.to(socket.roomId).emit('peer-disconnected', {
        userId: socket.id,
        reason,
      });
      socket.leave(socket.roomId);
      socket.roomId = null;
    }
  });

  socket.on('error', (error) => {
    console.error(`Socket ${socket.id} error:`, error);
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Update the port configuration
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
  console.log(`Frontend URL: ${FRONTEND_URL}`);
});