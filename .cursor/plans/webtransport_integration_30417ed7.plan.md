---
name: WebTransport Integration
overview: Replace Socket.IO with WebTransport for lower latency networking, leveraging unreliable datagrams for position updates and reliable streams for critical events.
todos:
  - id: transport-interface
    content: Define Transport interface abstracting over Socket.IO and WebTransport
    status: pending
  - id: socketio-transport
    content: Wrap current Socket.IO logic in SocketIOTransport implementation
    status: pending
  - id: webtransport-impl
    content: Implement WebTransportTransport for client and server
    status: pending
  - id: fallback
    content: Add automatic fallback from WebTransport to WebSocket
    status: pending
---

# WebTransport Integration

## Overview

WebTransport provides lower latency than WebSocket with support for unreliable datagrams (no head-of-line blocking) and multiple streams. This is ideal for real-time games where stale position data should be dropped rather than queued.

## Architecture

```mermaid
flowchart LR
    subgraph Client
        Inputs[Input Events]
        Actions[Action Events]
    end
    
    subgraph Transport
        Datagrams[Unreliable Datagrams]
        Streams[Reliable Streams]
    end
    
    subgraph Server
        Snapshots[World Snapshots]
        Events[Game Events]
    end
    
    Inputs -->|Position/Movement| Datagrams
    Datagrams -->|Snapshots| Snapshots
    Actions -->|Hits/Joins/Leaves| Streams
    Streams -->|Acks/Results| Events
```

## Channel Strategy

| Data Type | Channel | Reason |

|-----------|---------|--------|

| Input messages | Unreliable datagram | Stale inputs are useless |

| World snapshots | Unreliable datagram | Latest state matters most |

| Player join/leave | Reliable stream | Must not be lost |

| Action events (shoot) | Reliable stream | Must be processed |

| Action results | Reliable stream | Player needs feedback |

## Key Components

### 1. Transport Abstraction Layer

- Create `Transport` interface in new [`packages/netcode/src/transport/`](packages/netcode/src/transport/)
- Implement `SocketIOTransport` (current behavior)
- Implement `WebTransportTransport` (new)
- Allow swapping transports without changing game code

### 2. Server Setup

- Bun supports WebTransport via `Bun.serve()` with HTTP/3
- Requires TLS certificates (self-signed for dev)
- Fallback to WebSocket for browsers without WebTransport support

### 3. Client Setup

- Use native `WebTransport` API
- Handle connection lifecycle (connect, disconnect, reconnect)
- Manage datagram vs stream sending

### 4. Serialization

- Datagrams need compact binary format (consider MessagePack or custom)
- Include sequence numbers for ordering/staleness detection

## Considerations

- **Browser support**: WebTransport is Chrome 97+, need fallback
- **TLS requirement**: WebTransport requires HTTPS, complicates local dev
- **Bun support**: Verify Bun's WebTransport server capabilities