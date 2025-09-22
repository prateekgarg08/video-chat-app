"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const ws = require("ws");
const mediasoup = __importStar(require("mediasoup"));
let worker;
let router;
async function initMediasoup() {
    worker = await mediasoup.createWorker();
    router = await worker.createRouter();
}
initMediasoup();
// Room storage
const rooms = new Map();
// Create WebSocket server
const server = new ws.Server({
    port: 8080,
    host: "0.0.0.0", // Bind to all network interfaces
    verifyClient: (info) => {
        // Allow all origins for CORS
        return true;
    },
    handleProtocols: (protocols, request) => {
        // Handle any subprotocols if needed
        return protocols[0] || false;
    },
});
// Add CORS headers for HTTP upgrade requests
server.on("headers", (headers, request) => {
    headers.push("Access-Control-Allow-Origin: *");
    headers.push("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
    headers.push("Access-Control-Allow-Headers: Content-Type, Authorization");
    headers.push("Access-Control-Allow-Credentials: true");
});
server.on("connection", (socket) => {
    console.log("Client connected");
    socket.on("close", () => {
        console.log("Client disconnected");
    });
    socket.on("message", (message) => {
        try {
            const data = JSON.parse(message.toString());
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
            }
            else if (data.type === "join-room") {
                if (rooms.has(data.roomId)) {
                    const room = rooms.get(data.roomId);
                    room.users[data.userId] = socket;
                    socket.send(JSON.stringify({
                        type: "offer",
                        roomId: data.roomId,
                        offer: room.offer,
                    }));
                }
                else {
                    console.log("room not found");
                }
            }
            else if (data.type === "answer") {
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
                room.users[otherUser].send(JSON.stringify({
                    type: "answer",
                    answer: data.answer,
                }));
            }
            else if (data.type === "getRouterCapabilities") {
                console.log("sending routerCapabilities", router.rtpCapabilities);
                socket.send(JSON.stringify({
                    type: "routerCapabilities",
                    capabilities: router.rtpCapabilities,
                }));
            }
        }
        catch (error) {
            console.error("Error parsing message:", error);
        }
    });
    socket.on("error", (error) => {
        console.log("Error", error);
    });
});
console.log("WebSocket server running on ws://0.0.0.0:8080");
