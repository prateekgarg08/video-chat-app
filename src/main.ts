const ws = require("ws");
const mediasoup = require("mediasoup");

import { Worker, Router, WebRtcServer, Transport } from "mediasoup/node/lib/types";

// Define interfaces for type safety
interface WebRTCOffer {
  type: string;
  sdp: string;
}

interface WebRTCAnswer {
  type: string;
  sdp: string;
}

interface MessageData {
  type: "offer" | "join-room" | "answer" | "getRouterCapabilities" | "createTransport" | "connectTransport";
  roomId: string;
  userId: string;
  offer?: WebRTCOffer;
  answer?: WebRTCAnswer;
  data?: any;
}

interface Room {
  users: { [userId: string]: any };
  offer: WebRTCOffer;
}

let worker: Worker;
let router: Router;
let webRtcServer: WebRtcServer;
async function initMediasoup() {
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({
    mediaCodecs: [
      { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
      { kind: "video", mimeType: "video/VP8", clockRate: 90000 },
    ],
  });
  // webRtcServer = await worker.createWebRtcServer({
  //   listenInfos: [
  //     {
  //       ip: "0.0.0.0",
  //       port: 8081,
  //       protocol: "udp",
  //     },
  //     {
  //       ip: "0.0.0.0",
  //       port: 8081,
  //       protocol: "tcp",
  //     },
  //   ],
  // });
}
initMediasoup();

// Room storage
const rooms = new Map<string, Room>();
const transports = new Map<object, Transport>();
const producers = new Map();
const consumers = new Map();
// Create WebSocket server
const server = new ws.Server({
  port: 8080,
  verifyClient: (info: any): boolean => {
    // Allow all origins for CORS
    return true;
  },
  handleProtocols: (protocols: string[], request: any): string | false => {
    // Handle any subprotocols if needed
    return protocols[0] || false;
  },
});

// Add CORS headers for HTTP upgrade requests
server.on("headers", (headers: string[], request: any): void => {
  headers.push("Access-Control-Allow-Origin: *");
  headers.push("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
  headers.push("Access-Control-Allow-Headers: Content-Type, Authorization");
  headers.push("Access-Control-Allow-Credentials: true");
});

server.on("connection", (socket: any): void => {
  console.log("Client connected");

  socket.on("close", (): void => {
    console.log("Client disconnected");
  });

  socket.on("message", async (message: any): Promise<void> => {
    try {
      const data: MessageData = JSON.parse(message.toString());
      console.log("Message", data);

      if (data.type === "offer") {
        if (!data.offer) {
          console.error("Offer data is missing");
          return;
        }

        rooms.set(data.roomId, {
          users: { [data.userId]: socket },
          offer: data.offer,
        });

        console.log("room created");
        console.log("rooms", rooms);
      } else if (data.type === "join-room") {
        if (rooms.has(data.roomId)) {
          const room = rooms.get(data.roomId)!;
          room.users[data.userId] = socket;

          socket.send(
            JSON.stringify({
              type: "offer",
              roomId: data.roomId,
              offer: room.offer,
            })
          );
        } else {
          console.log("room not found");
        }
      } else if (data.type === "answer") {
        if (!data.answer) {
          console.error("Answer data is missing");
          return;
        }

        const room = rooms.get(data.roomId);
        if (!room) {
          console.error("Room not found for answer");
          return;
        }

        const otherUser = Object.keys(room.users).find((key) => key !== data.userId);
        if (!otherUser || !room.users[otherUser]) {
          console.error("Other user not found");
          return;
        }

        room.users[otherUser].send(
          JSON.stringify({
            type: "answer",
            answer: data.answer,
          })
        );
      } else if (data.type === "getRouterCapabilities") {
        console.log("sending routerCapabilities", router.rtpCapabilities);
        socket.send(
          JSON.stringify({
            type: "routerCapabilities",
            capabilities: router.rtpCapabilities,
          })
        );
      } else if (data.type === "createTransport") {
        const transport = await router.createWebRtcTransport({
          listenIps: [{ ip: "127.0.0.1" }],
        });
        transports.set(socket, transport);

        console.log("transport", transport);
        console.log("transports");
        socket.send(
          JSON.stringify({
            type: "createTransport",
            transport: {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
            },
          })
        );
      } else if (data.type === "connectTransport") {
        const transport = transports.get(socket);
        if (!transport) {
          console.error("Transport not found");
          return;
        }
        console.log("connecting to transport", transport.id);
        console.log("dtlsParameters", data.data.dtlsParameters);
        await transport.connect({ dtlsParameters: data.data.dtlsParameters });

        socket.send(
          JSON.stringify({
            type: "connectTransport",
            transport: {
              id: transport.id,
            },
          })
        );
      } else if (data.type === "produce") {
        const transport = transports.get(socket);
        if (!transport) return;
        const producer = await transport.produce({
          kind: data.data.kind,
          rtpParameters: data.data.rtpParameters,
        });
        producers.set(socket, producer);

        socket.send(
          JSON.stringify({
            type: "produce",
            data: { id: producer.id },
          })
        );
      } else if (data.type === "consume") {
        const transport = transports.get(socket);
        const { producerId, rtpCapabilities } = data.data;

        if (!router.canConsume({ producerId, rtpCapabilities: rtpCapabilities })) {
          socket.send(
            JSON.stringify({
              type: "consume",
              error: "Cannot be consumed",
            })
          );
          return;
        }
        if (!transport) return;

        const consumer = await transport.consume({
          producerId,
          rtpCapabilities: rtpCapabilities,
          paused: false,
        });

        console.log("consumer", {
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          producerPaused: consumer.producerPaused,
        });

        socket.send(
          JSON.stringify({
            type: "consume",
            data: {
              id: consumer.id,
              producerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
            },
          })
        );
      }
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  });

  socket.on("error", (error: Error): void => {
    console.log("Error", error);
  });
});

console.log("WebSocket server running on ws://0.0.0.0:8080");
