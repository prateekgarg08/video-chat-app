const ws = require('ws');


const rooms = new Map();

const server = new ws.Server({ port: 8080 });

server.on('connection', (socket) => {
  // console.log(socket)
  console.log('Client connected');
  socket.on('close', () => {
    console.log('Client disconnected');
  });







  socket.on('message', (message) => {
    const data = JSON.parse(message);
    console.log('Message', data);
    if (data.type === 'offer') {
      rooms.set(data.roomId, {
        users: { [data.userId]: socket },
        offer: data.offer,
      });

      console.log('room created')
      console.log('rooms', rooms);
    } else if (data.type === 'join-room') {
      if (rooms.has(data.roomId)) {
        rooms.get(data.roomId).users[data.userId] = socket;

        const room = rooms.get(data.roomId);

        socket.send(JSON.stringify({
          type: 'offer',
          roomId: data.roomId,
          offer: room.offer,
        }));
        // console.log('user joined room')
        // console.log('rooms', rooms);
      } else {
        console.log('room not found')
      }
    } else if (data.type === 'answer') {
      const room = rooms.get(data.roomId);
      // console.log('room', room);
      // console.log('data', data);
      const otherUser = Object.keys(room.users).find(key => key !== data.userId);
      // console.log('otherUser', otherUser);
      // console.log('room.users[otherUser]', room.users[otherUser]);
      room.users[otherUser].send(JSON.stringify({
        type: 'answer',
        answer: data.answer,
      }));

    }
  });


  socket.on('error', (error) => {
    console.log('Error', error);
  });
});


