const ws = require("ws");
const mediasoup = require("mediasoup");

import { Worker, Router, WebRtcServer, Transport, Producer } from "mediasoup/node/lib/types";

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
  type:
    | "offer"
    | "join-room"
    | "answer"
    | "getRouterCapabilities"
    | "createTransport"
    | "connectTransport"
    | "produce"
    | "consume"
    | "getProducers";
  roomId: string;
  userId: string;
  offer?: WebRTCOffer;
  answer?: WebRTCAnswer;
  data?: any;
}

interface Room {
  users: { [userId: string]: any };
  producers: { [userId: string]: { [kind: string]: string } }; // userId -> {audio: producerId, video: producerId}
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
const producers = new Map<object, Map<string, any>>(); // websocket -> Map<kind, producer>
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

function generateSDP(producer, ip, port) {
  const codec = producer.rtpParameters.codecs[0];
  const ssrc = producer.rtpParameters.encodings[0].ssrc;

  let fmtpLine = "";

  // Only H264 needs packetization-mode & profile-level-id
  if (codec.mimeType.includes("H264")) {
    const packetizationMode = codec.parameters["packetization-mode"] || 1;
    const profileLevelId = codec.parameters["profile-level-id"] || "42e01f";
    fmtpLine = `a=fmtp:${codec.payloadType} packetization-mode=${packetizationMode};profile-level-id=${profileLevelId}`;
  }

  return `
v=0
o=- 0 0 IN IP4 ${ip}
s=Mediasoup RTP Stream
c=IN IP4 ${ip}
t=0 0
m=${codec.mimeType.split("/")[1].toLowerCase()} ${port} RTP/AVP ${codec.payloadType}
a=rtpmap:${codec.payloadType} ${codec.mimeType.split("/")[1]}/${codec.clockRate}
${fmtpLine}
a=ssrc:${ssrc} cname:mediasoup
  `.trim();
}

// Store plain transports to avoid creating multiple for the same purpose
const plainTransports = new Map<string, any>();

// Port management for automatic assignment
const usedPorts = new Set<number>();
const BASE_PORT = 18000;
const MAX_PORT = 19000;

const findAvailablePort = (): number => {
  for (let port = BASE_PORT; port < MAX_PORT; port++) {
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }
  throw new Error(`No available ports in range ${BASE_PORT}-${MAX_PORT}`);
};

const releasePort = (port: number) => {
  usedPorts.delete(port);
};

const createWebRTCToRTPBridge = async (webRTCProducerId: string, outputPort?: number, socket: any, kind: string) => {
  console.log("Creating WebRTC to RTP bridge for producer:", webRTCProducerId);

  // Check if we already have a bridge for this producer
  if (plainTransports.has(webRTCProducerId)) {
    console.log("Reusing existing RTP bridge for producer:", webRTCProducerId);
    return plainTransports.get(webRTCProducerId);
  }

  const webRTCTransport = transports.get(socket);
  const originalProducer = (producers.get(socket) as Map<string, Producer>).get(kind) as Producer;

  if (!webRTCTransport || !originalProducer || originalProducer.id !== webRTCProducerId) {
    throw new Error(`WebRTC producer not found: ${webRTCProducerId}`);
  }

  console.log("Found WebRTC producer:", {
    id: originalProducer.id,
    kind: originalProducer.kind,
    paused: originalProducer.paused,
  });

  const webRTCConsumer = await webRTCTransport.consume({
    producerId: originalProducer.id,
    rtpCapabilities: router.rtpCapabilities,
  });

  console.log("WebRTC consumer created:", {
    id: webRTCConsumer.id,
    kind: webRTCConsumer.kind,
    producerId: webRTCProducerId,
  });

  originalProducer.on("score", (scoreEvent: any) => {
    console.log("originalProducer score", scoreEvent);
  });

  originalProducer.on("transportclose", () => {
    console.log("originalProducer transportclose");
  });

  const targetPort = outputPort || findAvailablePort();

  console.log("targetPort", targetPort);

  // Step 2: Create a plain transport for RTP output
  const plainTransport = await router.createPlainTransport({
    listenInfo: { ip: "127.0.0.1", protocol: "udp" },
    rtcpMux: true,
    comedia: false,
  });

  await plainTransport.connect({
    ip: "127.0.0.1",
    port: targetPort,
  });

  // Step 4: Create a consumer on the plain transport to consume from the WebRTC producer
  // This is the key - the plain transport consumes from the WebRTC producer and sends RTP out
  const plainConsumer = await plainTransport.consume({
    producerId: webRTCProducerId, // Consume directly from the WebRTC producer
    rtpCapabilities: router.rtpCapabilities,
  });

  console.log("Plain consumer created:", {
    id: plainConsumer.id,
    kind: plainConsumer.kind,
    producerId: webRTCProducerId,
  });

  console.log("resuming plain consumer");
  await plainConsumer.resume();
  console.log("resumed plain consumer");

  // The plain transport will now send RTP packets to the connected endpoint (ffplay)

  const bridgeInfo = {
    plainTransport,
    plainConsumer,
    outputPort: targetPort,
    webRTCProducerId,
  };

  // Store the bridge for potential reuse
  plainTransports.set(webRTCProducerId, bridgeInfo);

  console.log("Bridge created successfully:", {
    webRTCProducerId,
    rtpPort: targetPort,
    kind: plainConsumer.kind,
  });

  bridgeInfo.plainConsumer.on("score", (scoreEvent: any) => {
    console.log("score", scoreEvent);
  });

  bridgeInfo.plainConsumer.on("transportclose", () => {
    console.log("transportclose");
  });

  bridgeInfo.plainConsumer.on("producerclose", () => {
    console.log("producerclose");
  });

  bridgeInfo.plainConsumer.on("rtp", () => {
    console.log("consumerclose");
  });

  setTimeout(() => {
    console.log("plainConsumer after 10 seconds", bridgeInfo.plainConsumer);
  }, 10000);

  return bridgeInfo;
};

// Function to clean up a bridge and release resources
const destroyBridge = async (webRTCProducerId: string) => {
  const bridge = plainTransports.get(webRTCProducerId);
  if (!bridge) {
    console.log("No bridge found for producer:", webRTCProducerId);
    return;
  }

  try {
    // Close consumer
    if (bridge.plainConsumer && !bridge.plainConsumer.closed) {
      bridge.plainConsumer.close();
    }

    // Close transport
    if (bridge.plainTransport && !bridge.plainTransport.closed) {
      bridge.plainTransport.close();
    }

    // Release the port
    releasePort(bridge.outputPort);

    // Remove from map
    plainTransports.delete(webRTCProducerId);

    console.log("Bridge destroyed for producer:", webRTCProducerId, "port released:", bridge.outputPort);
  } catch (error) {
    console.error("Error destroying bridge:", error);
  }
};

// Helper function to generate SDP for the RTP stream
const generateSDPForBridge = (bridgeInfo: any): string => {
  const { plainConsumer, outputPort } = bridgeInfo;
  const rtpParameters = plainConsumer.rtpParameters;

  // Get the first codec
  const codec = rtpParameters.codecs[0];
  const payloadType = codec.payloadType;

  let codecName = codec.mimeType.split("/")[1].toUpperCase();
  let clockRate = codec.clockRate;

  return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=Mediasoup WebRTC to RTP Bridge
c=IN IP4 127.0.0.1
t=0 0
m=${plainConsumer.kind} ${outputPort} RTP/AVP ${payloadType}
a=rtpmap:${payloadType} ${codecName}/${clockRate}
a=recvonly`;
};

// Single RTP stream setup
const setupRTPStream = async (webRTCProducerId: string, customPort?: number, socket: any, kind: string) => {
  try {
    // Create the bridge
    const bridge = await createWebRTCToRTPBridge(webRTCProducerId, customPort, socket, kind);

    // Generate SDP file content
    const sdpContent = generateSDPForBridge(bridge);

    console.log("Generated SDP for producer:", webRTCProducerId);
    console.log(sdpContent);

    // Save SDP to file (you might want to use fs.writeFileSync in Node.js)
    // fs.writeFileSync(`bridge-${webRTCProducerId}.sdp`, sdpContent);

    console.log(`RTP stream available at: rtp://127.0.0.1:${bridge.outputPort}`);
    console.log(
      `Use this command to view: ffplay -protocol_whitelist file,udp,rtp -i rtp://127.0.0.1:${bridge.outputPort}`
    );

    return bridge;
  } catch (error) {
    console.error("Error setting up RTP stream:", error);
    throw error;
  }
};

// const setupMultipleRTPStreams = async (webRTCProducerIds: string[]) => {
//   const bridges = [];

//   for (const producerId of webRTCProducerIds) {
//     try {
//       const bridge = await setupRTPStream(producerId,undefined,socket);
//       bridges.push(bridge);

//       console.log(`Producer ${producerId} → RTP port ${bridge.outputPort}`);
//       console.log(`Command: ffplay -protocol_whitelist file,udp,rtp -i rtp://127.0.0.1:${bridge.outputPort}`);
//     } catch (error) {
//       console.error(`Failed to setup RTP stream for producer ${producerId}:`, error);
//     }
//   }

//   return bridges;
// };

// // Get all active bridges
// const getActiveBridges = () => {
//   const bridges = [];
//   for (const [producerId, bridge] of plainTransports.entries()) {
//     bridges.push({
//       webRTCProducerId: producerId,
//       rtpPort: bridge.outputPort,
//       kind: bridge.plainConsumer.kind,
//       rtpUrl: `rtp://127.0.0.1:${bridge.outputPort}`,
//     });
//   }
//   return bridges;
// };

// Example usage:
// const bridges = await setupMultipleRTPStreams(['producer-1', 'producer-2']);
// console.log('Active bridges:', getActiveBridges());

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

    // Clean up transports for this socket
    if (transports.has(socket)) {
      const transport = transports.get(socket);
      transport?.close();
      transports.delete(socket);
    }

    // Clean up producers for this socket
    if (producers.has(socket)) {
      const socketProducers = producers.get(socket);
      socketProducers?.forEach((producer, kind) => {
        // Clean up associated plain transports
        if (plainTransports.has(producer.id)) {
          const plainTransportData = plainTransports.get(producer.id);
          plainTransportData.transport?.close();
          plainTransportData.consumer?.close();
          plainTransports.delete(producer.id);
        }
        producer.close();
      });
      producers.delete(socket);
    }

    // Remove socket from rooms
    rooms.forEach((room, roomId) => {
      const userIds = Object.keys(room.users);
      userIds.forEach((userId) => {
        if (room.users[userId] === socket) {
          delete room.users[userId];
          // If room is empty, remove it
          if (Object.keys(room.users).length === 0) {
            rooms.delete(roomId);
          }
        }
      });
    });
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
          producers: {},
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

        const sdp = generateSDP(producer, "127.0.0.1", 6969);
        console.log("::::::::::::::::::::SDP:::::::::::::::::::\n" + sdp);
        // Store multiple producers per socket (one for each kind: audio/video)
        if (!producers.has(socket)) {
          producers.set(socket, new Map());
        }
        const socketProducers = producers.get(socket)!;
        socketProducers.set(data.data.kind, producer);

        console.log(`Producer created for ${data.data.kind}:`, producer.id);

        socket.send(
          JSON.stringify({
            type: "produce",
            data: { id: producer.id },
          })
        );

        await setupRTPStream(producer.id, undefined, socket, data.data.kind);
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
      } else if (data.type === "getProducers") {
        // Get all producers from all connected clients
        const allProducers: Array<{ id: string; kind: string; socketId: string }> = [];

        producers.forEach((socketProducers, producerSocket) => {
          if (producerSocket !== socket) {
            // Don't include own producers
            socketProducers.forEach((producer, kind) => {
              allProducers.push({
                id: producer.id,
                kind: kind,
                socketId: producerSocket.toString(), // Simple identifier
              });
            });
          }
        });

        console.log("Available producers:", allProducers);

        socket.send(
          JSON.stringify({
            type: "getProducers",
            data: { producers: allProducers },
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
