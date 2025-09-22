import { useState } from "react";
import type {
  RtpCapabilities,
  AppData,
  TransportOptions,
  DtlsParameters,
  RtpParameters,
  MediaKind,
} from "mediasoup-client/types";

export const useSignaling = () => {
  const [ws, setWs] = useState<WebSocket | null>(null);

  const handleMissingWs = () => {
    alert("WebSocket connection is missing");
  };

  const waitForRouterCapabilities = async (ws: WebSocket): Promise<RtpCapabilities | undefined> => {
    if (!ws) {
      handleMissingWs();
      return;
    }
    return new Promise((resolve) => {
      ws?.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "routerCapabilities") {
          resolve(data.capabilities);
        }
      });
    });
  };

  const requestRouterCapabilities = async (ws: WebSocket) => {
    ws.send(
      JSON.stringify({
        type: "getRouterCapabilities",
      })
    );
    const capabilities = await waitForRouterCapabilities(ws);
    return capabilities;
  };

  // const waitForOffer = async () => {
  //   if (!ws) {
  //     handleMissingWs();
  //     return;
  //   }
  //   return new Promise((resolve) => {
  //     ws?.addEventListener("message", (event) => {
  //       const data = JSON.parse(event.data);
  //       if (data.type === "offer") {
  //         resolve(data.offer);
  //       }
  //     });
  //   });
  // };

  // const waitForAnswer = async () => {
  //   if (!ws) {
  //     handleMissingWs();
  //     return;
  //   }
  //   return new Promise((resolve) => {
  //     ws?.addEventListener("message", (event) => {
  //       const data = JSON.parse(event.data);
  //       if (data.type === "answer") {
  //         resolve(data.answer);
  //       }
  //     });
  //   });
  // };

  // const waitForIceCandidate = async (peerConnection: RTCPeerConnection) => {
  //   return new Promise((resolve) => {
  //     peerConnection.addEventListener("icecandidate", () => {
  //       resolve(true);
  //     });
  //   });
  // };

  const waitForTransport = async (ws: WebSocket): Promise<TransportOptions<AppData> | undefined> => {
    return new Promise((resolve) => {
      ws?.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "createTransport") {
          resolve(data.transport);
        }
      });
    });
  };

  const initializeConnection = (onInit: (ws: WebSocket) => void) => {
    const ws = new WebSocket(`ws://localhost:8080`);
    setWs(ws);
    ws.onopen = () => {
      onInit(ws);
    };
    return ws;
  };

  const requestTransport = async () => {
    if (!ws) {
      handleMissingWs();
      return;
    }
    ws.send(JSON.stringify({ type: "createTransport" }));
    const transport = await waitForTransport(ws);
    if (!transport) return;
    return transport;
  };

  const waitForConnectTransport = async (ws: WebSocket): Promise<{ id: string }> => {
    return new Promise((resolve) => {
      ws?.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "connectTransport") {
          resolve(data.transport);
        }
      });
    });
  };

  const requestConnectTransport = async (data: { dtlsParameters: DtlsParameters }) => {
    if (!ws) {
      handleMissingWs();
      return;
    }
    ws.send(JSON.stringify({ type: "connectTransport", data }));
    const connectTransport = await waitForConnectTransport(ws);
    console.log("got connectTransport", connectTransport);
    if (!connectTransport) return;
    return connectTransport;
  };

  const waitForProduce = async (ws: WebSocket): Promise<{ id: string } | undefined> => {
    return new Promise((resolve) => {
      ws?.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "produce") {
          resolve(data.data);
        }
      });
    });
  };

  const requestProduce = async (data: { kind: string; rtpParameters: RtpParameters }) => {
    if (!ws) {
      handleMissingWs();
      return;
    }
    ws.send(JSON.stringify({ type: "produce", data }));
    const produce = await waitForProduce(ws);
    if (!produce) return;
    return produce;
  };

  const waitForConsume = async (
    ws: WebSocket
  ): Promise<{ id: string; producerId: string; kind: MediaKind; rtpParameters: RtpParameters } | undefined> => {
    return new Promise((resolve) => {
      ws?.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "consume") {
          resolve(data.data);
        }
      });
    });
  };

  const requestConsume = async (data: { producerId: string; rtpCapabilities: RtpCapabilities }) => {
    if (!ws) {
      handleMissingWs();
      return;
    }
    ws.send(JSON.stringify({ type: "consume", data }));
    const consume = await waitForConsume(ws);
    console.log("got consume", consume);
    if (!consume) return;
    return consume;
  };

  return {
    ws,
    initializeConnection,
    handleMissingWs,
    requestTransport,
    requestRouterCapabilities,
    requestConnectTransport,
    requestProduce,
    requestConsume,
  };
};
