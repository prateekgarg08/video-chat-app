// Type declarations for ws module
declare module "ws" {
  import { EventEmitter } from "events";

  class WebSocket extends EventEmitter {
    send(data: string): void;
    on(event: "message", listener: (data: any) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
  }

  class Server extends EventEmitter {
    constructor(options?: {
      port?: number;
      host?: string;
      verifyClient?: (info: any) => boolean;
      handleProtocols?: (protocols: string[], request: any) => string | false;
    });

    on(event: "connection", listener: (socket: any) => void): this;
    on(event: "headers", listener: (headers: string[], request: any) => void): this;
  }

  const ws: {
    Server: typeof Server;
    WebSocket: typeof WebSocket;
  };

  export = ws;
}
