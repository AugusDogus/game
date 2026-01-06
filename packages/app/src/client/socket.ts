import { io } from "socket.io-client";
import { superjsonParser } from "@game/netcode";

export const socket = io({
  // TODO: Add "webtransport" once Bun supports HTTP/3 (https://github.com/oven-sh/bun/issues/13656)
  transports: ["websocket", "polling"],
  autoConnect: false,
  // Use superjson parser for proper Map/Set/Date serialization
  parser: superjsonParser,
});
