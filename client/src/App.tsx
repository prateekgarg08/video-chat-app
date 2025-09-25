import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Video, Users, Plus, LogIn, Copy, CheckCircle } from "lucide-react";
import { useSignaling } from "./hooks/useSignaling";
import { Device } from "mediasoup-client";
// import type { RtpCapabilities } from "mediasoup-client/types";
const generateRandomString = (length: number = 10): string => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

function App() {
  const initialRoomId = useRef<string>(generateRandomString(12));
  const [roomId, setRoomId] = useState<string>(initialRoomId.current);
  // const [producers, setProducers] = useState<{ video?: string; audio?: string }>({});
  // const userIdRef = useRef<string>(generateRandomString(12));
  const {
    initializeConnection,
    requestTransport,
    requestRouterCapabilities,
    requestConnectTransport,
    requestProduce,
    requestConsume,
    requestProducers,
  } = useSignaling();

  // const peerConnectionRef = useRef<RTCPeerConnection>(new RTCPeerConnection());

  // const [routerCapabilities, setRouterCapabilities] = useState<RtpCapabilities | null>(null);

  const localVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoElementRef = useRef<HTMLVideoElement | null>(null);
  const deviceRef = useRef<Device>(new Device());

  const initalizeMediasoup = useCallback(async (ws: WebSocket) => {
    const capabilities = await requestRouterCapabilities(ws);
    if (!capabilities) return;
    // setRouterCapabilities(capabilities);
    if (deviceRef.current.loaded) return;
    await deviceRef.current.load({ routerRtpCapabilities: capabilities });
  }, []);

  useEffect(() => {
    initializeConnection(initalizeMediasoup);
  }, []);

  const handleCreateRoom = async () => {
    const transport = await requestTransport();
    if (!transport) return;

    console.log("transport", transport);

    const sendTransport = await deviceRef.current.createSendTransport(transport);

    sendTransport.on("icecandidateerror", (error) => {
      console.log("icecandidateerror", error);
    });

    sendTransport.on("icegatheringstatechange", (event) => {
      console.log("icegatheringstatechange", event);
    });

    sendTransport.on("connectionstatechange", (state) => {
      console.log("🔄 send transport connectionstatechange:", state);
    });

    sendTransport.on("connect", async ({ dtlsParameters }, callback, error) => {
      console.log("🔗 Send transport connect event triggered");
      try {
        await requestConnectTransport({ dtlsParameters });
        console.log("✅ Transport connection request completed");
        callback();
      } catch (err) {
        console.error("❌ Transport connection failed:", err);
        if (error) {
          error(err as Error);
        }
      }
    });

    sendTransport.on("produce", async ({ kind, rtpParameters }, callback) => {
      console.log("🎬 Producing", { kind, rtpParameters });
      try {
        const producer = await requestProduce({ kind, rtpParameters });
        if (!producer) return;

        // Store producer ID based on track kind (commented out for now)
        // setProducers((prev) => ({
        //   ...prev,
        //   [kind]: producer.id,
        // }));

        // Use the first producer ID as room ID for simplicity
        if (roomId === initialRoomId.current) {
          setRoomId(producer.id);
        }

        callback({ id: producer.id });
      } catch (err) {
        console.error("❌ Producer creation failed:", err);
      }
    });

    console.log("requesting media");

    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(async (stream) => {
      console.log("got media streams");
      if (localVideoElementRef.current && !localVideoElementRef.current.srcObject) {
        localVideoElementRef.current.srcObject = stream;
        localVideoElementRef.current?.play();
      }

      // Produce each track separately
      for (const track of stream.getTracks()) {
        console.log(`Producing ${track.kind} track`);
        try {
          await sendTransport.produce({ track });
        } catch (error) {
          console.error(`Error producing ${track.kind} track:`, error);
        }
      }
    });
  };

  // const handleCreateRoom = async () => {
  //   await createRoom();
  // };
  const handleJoinRoom = async (roomId: string) => {
    const transport = await requestTransport();
    if (!transport) return;
    const recvTransport = await deviceRef.current.createRecvTransport(transport);
    recvTransport.on("connect", async ({ dtlsParameters }, callback) => {
      console.log("connecting to recv transport");
      await requestConnectTransport({ dtlsParameters });
      callback();
      console.log("connected to recv transport");
    });

    const stream = new MediaStream();
    let consumersConnected = 0;
    const expectedConsumers = 2; // audio + video

    recvTransport.on("connectionstatechange", (state) => {
      console.log("🔄 recv transport connectionstatechange:", state);
      switch (state) {
        case "connected":
          console.log("✅ Transport successfully connected!");
          break;
        case "failed":
          console.log("❌ Transport connection failed");
          break;
        case "disconnected":
          console.log("⚠️ Transport disconnected");
          break;
        case "closed":
          console.log("🚪 Transport closed");
          break;
      }
    });

    // Function to consume a single producer
    const consumeProducer = async (producerId: string) => {
      try {
        const consumer = await requestConsume({
          producerId,
          rtpCapabilities: deviceRef.current.rtpCapabilities,
        });

        if (!consumer) {
          console.warn(`Failed to get consumer for producer ${producerId}`);
          return;
        }

        const { id, producerId: consumerProducerId, kind, rtpParameters } = consumer;
        const mediaConsumer = await recvTransport.consume({
          id,
          producerId: consumerProducerId,
          kind,
          rtpParameters,
        });

        console.log(`Consuming ${kind} track from producer ${producerId}`);
        await mediaConsumer.resume();

        console.log("adding stream");
        // Add track to the stream
        stream.addTrack(mediaConsumer.track);
        consumersConnected++;

        // If we have all expected tracks, set up the video element
        if (consumersConnected === expectedConsumers) {
          console.log("remoteVideoElementRef.current", remoteVideoElementRef.current);

          if (remoteVideoElementRef.current && !remoteVideoElementRef.current.srcObject) {
            console.log("Setting remote video element with stream containing", stream.getTracks().length, "tracks");
            remoteVideoElementRef.current.srcObject = stream;
            remoteVideoElementRef.current?.play();
          }
        }
      } catch (error) {
        console.error(`Error consuming producer ${producerId}:`, error);
      }
    };

    // Get all available producers and consume them
    try {
      const availableProducers = await requestProducers();
      if (availableProducers && availableProducers.length > 0) {
        console.log("Found available producers:", availableProducers);

        // Consume each available producer
        for (const producer of availableProducers) {
          await consumeProducer(producer.id);
        }
      } else {
        console.log("No producers found, trying roomId as fallback");
        // Fallback: try to consume the roomId as a producer ID
        await consumeProducer(roomId);
      }
    } catch (error) {
      console.error("Error getting producers:", error);
      // Fallback: try to consume the roomId as a producer ID
      await consumeProducer(roomId);
    }
  };

  const [joinRoomId, setJoinRoomId] = useState<string>("");
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState<boolean>(false);

  const [copied, setCopied] = useState<boolean>(false);

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-gradient-to-br from-violet-600 via-blue-600 to-cyan-600 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Card className="backdrop-blur-sm bg-white/95 shadow-2xl border-0">
            <CardHeader className="text-center pb-2">
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-gradient-to-r from-violet-500 to-blue-500 rounded-full">
                  <Video className="h-8 w-8 text-white" />
                </div>
              </div>
              <CardTitle className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-blue-600 bg-clip-text text-transparent">
                Video Chat
              </CardTitle>
              <CardDescription className="text-gray-600 mt-2">Connect with anyone, anywhere, instantly</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-6">
              <Button
                onClick={handleCreateRoom}
                className="w-full h-14 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
                size="lg"
              >
                <Plus className="mr-2 h-5 w-5" />
                Create New Room
              </Button>

              <Dialog open={isJoinDialogOpen} onOpenChange={setIsJoinDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full h-14 border-2 border-blue-200 hover:border-blue-300 hover:bg-blue-50 text-blue-700 shadow-md hover:shadow-lg transition-all duration-300 hover:scale-105"
                    size="lg"
                  >
                    <LogIn className="mr-2 h-5 w-5" />
                    Join Existing Room
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-blue-600" />
                      Join Room
                    </DialogTitle>
                    <DialogDescription>Enter the room ID to join an existing video chat</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <Input
                      placeholder="Enter Room ID"
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(e.target.value)}
                      className="text-center text-lg tracking-wider"
                      onKeyPress={(e) => e.key === "Enter" && handleJoinRoom(joinRoomId)}
                    />
                    <Button
                      onClick={() => handleJoinRoom(joinRoomId)}
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      disabled={!joinRoomId.trim()}
                    >
                      Join Room
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <div className="pt-4 border-t border-gray-200">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <p className="text-sm text-gray-500">Your Room ID</p>
                    <Badge variant="secondary" className="text-xs">
                      Ready
                    </Badge>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 border-2 border-dashed border-gray-200 relative group">
                    <code className="text-lg font-mono font-semibold text-gray-800 tracking-wider">{roomId}</code>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={copyRoomId}
                        >
                          {copied ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{copied ? "Copied!" : "Copy Room ID"}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Share this ID with others to invite them to your room</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4 items-center justify-center">
            <div className="flex items-center justify-center gap-2">
              <p className="text-sm text-gray-500">Your Video</p>
              <video ref={localVideoElementRef} autoPlay playsInline muted className="w-full h-full" />
            </div>
            <div className="flex items-center justify-center gap-2">
              <p className="text-sm text-gray-500">Remote Video</p>
              <video ref={remoteVideoElementRef} className="w-full h-full" autoPlay playsInline />
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default App;
