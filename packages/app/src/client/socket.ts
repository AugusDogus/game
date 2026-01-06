import { io } from "socket.io-client";

export const socket = io({
  // TODO: Add "webtransport" once Bun supports HTTP/3 (https://github.com/oven-sh/bun/issues/13656)
  transports: ["websocket", "polling"],
  autoConnect: false,
});
