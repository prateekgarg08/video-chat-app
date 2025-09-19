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

function App() {
  const [roomId, setRoomId] = useState<string>("");

  // Generate random string function
  const generateRandomString = (length: number = 10): string => {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  };

  const [ws, setWs] = useState<WebSocket | null>(null);

  const hostConnectionRef = useRef<RTCPeerConnection | null>(null);

  const userIdRef = useRef<string>(generateRandomString(12));

  useEffect(() => {
    // Generate random string when component mounts
    setRoomId(generateRandomString(12));
  }, []);

  const handleCreateRoom = () => {
    console.log("Creating room with ID:", roomId);

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        video.play();
        document.body.appendChild(video);

        console.log(stream);

        const localConnection = new RTCPeerConnection();
        hostConnectionRef.current = localConnection;
        localConnection.ontrack = (event) => {
          console.log("got track event", event);

          const video = document.createElement("video");
          video.srcObject = event.streams[0];
          video.play();
          document.body.appendChild(video);
        };
        localConnection.addTrack(stream.getTracks()[0], stream);

        // let offer: RTCSessionDescriptionInit | null = null;
        localConnection.createOffer().then((offer) => {
          localConnection.setLocalDescription(offer);

          if (ws) {
            ws.send(
              JSON.stringify({
                type: "offer",
                userId: userIdRef.current,
                roomId: roomId,
                offer: offer,
              })
            );
          }
        });
      })
      .catch((error) => {
        console.error("Error accessing media devices:", error);
      });

    // TODO: Implement room creation logic
  };

  const [joinRoomId, setJoinRoomId] = useState<string>("");
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleJoinRoom = () => {
    if (joinRoomId.trim() && ws) {
      console.log("Joining room:", joinRoomId);
      ws.send(
        JSON.stringify({
          type: "join-room",
          userId: userIdRef.current,
          roomId: joinRoomId,
        })
      );
      setIsJoinDialogOpen(false);
    }
  };

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy room ID:", err);
    }
  };

  useEffect(() => {
    let websocket: WebSocket | null = null;

    try {
      websocket = new WebSocket("ws://localhost:8080");
      setWs(websocket);
      websocket.onopen = () => {
        console.log("Connected to server");
      };
      websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log(data);

        if (data.type === "offer") {
          const offer = new RTCSessionDescription(data.offer);
          const roomId = data.roomId;

          const localConnection = new RTCPeerConnection();
          localConnection.ontrack = (event) => {
            console.log("got track event", event);
            const video = document.createElement("video");
            video.srcObject = event.streams[0];
            video.play();
            document.body.appendChild(video);
          };

          navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
            localConnection.addTrack(stream.getTracks()[0], stream);
            const video = document.createElement("video");
            video.srcObject = stream;
            video.play();
            document.body.appendChild(video);

            localConnection.setRemoteDescription(offer);
            localConnection.createAnswer().then((answer) => {
              localConnection.setLocalDescription(answer);
              websocket?.send(
                JSON.stringify({
                  type: "answer",
                  userId: userIdRef.current,
                  roomId: roomId,
                  answer: answer,
                })
              );
            });
          });
        } else if (data.type === "answer") {
          const answer = new RTCSessionDescription(data.answer);
          hostConnectionRef.current?.setRemoteDescription(answer);
        }

        // console.log(event.data);
      };
      // websocket.onerror = (error) => {
      //   console.error("WebSocket error:", error);
      // };
      // websocket.onclose = () => {
      //   console.log("WebSocket connection closed");
      // };
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
    }

    // Cleanup function
    return () => {
      if (websocket && (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING)) {
        websocket.close();
      }
    };
  }, []);

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
                      onKeyPress={(e) => e.key === "Enter" && handleJoinRoom()}
                    />
                    <Button
                      onClick={handleJoinRoom}
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
        </div>
      </div>
    </TooltipProvider>
  );
}

export default App;
