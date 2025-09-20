import { useEffect, useRef, useState } from "react";
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

const generateRandomString = (length: number = 10): string => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
};

function App() {
  // Generate random string function

  const [userId] = useState(generateRandomString(12));

  const [roomId] = useState<string>(generateRandomString(12));
  const [ws, setWs] = useState<WebSocket | null>(null);

  const locationConnectionRef = useRef<RTCPeerConnection>(new RTCPeerConnection());

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const answerResolveFunctionRef = useRef<((value: RTCSessionDescriptionInit) => void) | null>(null);
  const answer = useRef<RTCSessionDescriptionInit | null>(null);
  const offerResolveFunctionRef = useRef<((value: RTCSessionDescriptionInit) => void) | null>(null);
  const offer = useRef<RTCSessionDescriptionInit | null>(null);
  const iceGatheringCompleteRef = useRef<((value: boolean) => void) | null>(null);
  useEffect(() => {
    const socket = new WebSocket("ws://localhost:8080");

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("Message", data);
      if (data.type === "answer") {
        answer.current = data.answer;
        answerResolveFunctionRef.current!(data.answer);
      } else if (data.type === "offer") {
        offer.current = data.offer;
        offerResolveFunctionRef.current!(data.offer);
      }
    };

    setWs(socket);

    console.log("localVideoRef.current", localVideoRef.current);
    console.log("remoteVideoRef.current", remoteVideoRef.current);

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        console.log("Got local media stream");
        if (localVideoRef.current && !localVideoRef.current.srcObject) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(console.error);
          console.log("Set local video source");
        }

        stream.getTracks().forEach((track) => {
          console.log("Adding track to peer connection:", track);
          locationConnectionRef.current.addTrack(track, stream);
        });
      })
      .catch((error) => {
        console.error("Error accessing media devices:", error);
      });

    locationConnectionRef.current.ontrack = (event) => {
      console.log("Received remote track:", event.track);
      console.log("Remote streams:", event.streams);

      // Use the stream directly from the event
      if (event.streams && event.streams[0]) {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
          remoteVideoRef.current.play().catch(console.error);
          console.log("Set remote video source");
        }
      }
    };

    locationConnectionRef.current.onicecandidate = (event) => {
      console.log("ICE candidate updated", event.candidate);
      console.log("locationConnectionRef.current.localDescription", locationConnectionRef.current.localDescription);

      // When event.candidate is null, ICE gathering is complete
      if (event.candidate === null && iceGatheringCompleteRef.current) {
        console.log("ICE gathering complete");
        iceGatheringCompleteRef.current(true);
      }
    };
  }, []);

  const waitForAnswer = async () => {
    return new Promise((resolve) => {
      answerResolveFunctionRef.current = resolve;
    });
  };
  const waitForOffer = async () => {
    return new Promise((resolve) => {
      offerResolveFunctionRef.current = resolve;
    });
  };
  const waitForIceGatheringComplete = async () => {
    return new Promise((resolve) => {
      iceGatheringCompleteRef.current = resolve;
    });
  };

  const handleCreateRoom = async () => {
    const dc = locationConnectionRef.current.createDataChannel("channel");

    dc.onmessage = (event) => {
      console.log("Message", event.data);
    };
    dc.onopen = () => {
      console.log("Data channel opened");
      dc.send("hello from sender");
    };
    dc.onclose = () => {
      console.log("Data channel closed");
    };

    const offer = await locationConnectionRef.current.createOffer();
    await locationConnectionRef.current.setLocalDescription(offer);

    // Wait for ICE gathering to complete before sending the offer
    console.log("Waiting for ICE gathering to complete...");
    await waitForIceGatheringComplete();

    ws?.send(
      JSON.stringify({
        type: "offer",
        roomId: roomId,
        offer: locationConnectionRef.current.localDescription,
        userId: userId,
      })
    );
    console.log(new Date().getTime(), "offer sent");
    await waitForAnswer();
    console.log(new Date().getTime(), "answer received");
    console.log("answer.current", answer.current);
    await locationConnectionRef.current.setRemoteDescription(answer.current!);
    console.log(locationConnectionRef.current);
  };

  const handleJoinRoom = async (joinRoomId: string) => {
    ws?.send(
      JSON.stringify({
        type: "join-room",
        roomId: joinRoomId,
        userId: userId,
      })
    );

    locationConnectionRef.current.ondatachannel = (event) => {
      console.log("Data channel opened");
      const dc = event.channel;
      dc.onmessage = (event) => {
        console.log("Message", event.data);
      };
      dc.onopen = () => {
        console.log("Data channel opened");
      };
      dc.onclose = () => {
        console.log("Data channel closed");
      };
    };

    await waitForOffer();
    console.log(new Date().getTime(), "offer received");
    console.log("offer.current", offer.current);
    await locationConnectionRef.current.setRemoteDescription(offer.current!);

    const answer = await locationConnectionRef.current.createAnswer();
    await locationConnectionRef.current.setLocalDescription(answer);

    // Wait for ICE gathering to complete before sending the answer
    console.log("Waiting for ICE gathering to complete...");
    await waitForIceGatheringComplete();

    ws?.send(
      JSON.stringify({
        type: "answer",
        roomId: joinRoomId,
        answer: locationConnectionRef.current.localDescription,
        userId: userId,
      })
    );
    console.log(locationConnectionRef.current);
    console.log(new Date().getTime(), "answer sent");
  };

  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState("");
  const [copied, setCopied] = useState(false);

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
                          onClick={() => {
                            setCopied(true);
                            navigator.clipboard.writeText(roomId);
                          }}
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

          <div className="flex flex-col gap-4 mt-6">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Your Video</h3>
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full max-w-sm bg-gray-100 rounded-lg border-2 border-gray-200"
                />
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Remote Video</h3>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full max-w-sm bg-gray-100 rounded-lg border-2 border-gray-200"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default App;
