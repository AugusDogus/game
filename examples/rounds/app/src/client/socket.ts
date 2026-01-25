import { io } from "socket.io-client";
import { superjsonParser } from "@game/netcode/parser";

export const socket = io({
  autoConnect: false,
  parser: superjsonParser,
});
