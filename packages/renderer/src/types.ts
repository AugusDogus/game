/** Position history entry for debug visualization */
export interface PositionHistoryEntry {
  x: number;
  y: number;
  timestamp: number;
}

/** Debug data for visualization - tracks position history for local and remote entities */
export interface DebugData {
  /** Local player's predicted positions */
  localPredictedHistory: PositionHistoryEntry[];
  /** Local player's server-confirmed positions */
  localServerHistory: PositionHistoryEntry[];
  /** Other players' interpolated positions (client-side smoothed) */
  otherPlayersHistory: Map<string, PositionHistoryEntry[]>;
  /** Other players' raw server positions */
  otherPlayersServerHistory: Map<string, PositionHistoryEntry[]>;
}

/** Base render options for debug visualization */
export interface BaseRenderOptions {
  /** Debug data for position trails and ghost rendering */
  debugData: DebugData | null;
  /** Whether to show position trails */
  showTrails: boolean;
  /** Whether to show server position ghosts */
  showServerPositions: boolean;
}

/** Colors for debug visualization */
export const DEBUG_COLORS = {
  trailPredicted: 0x10b981, // emerald-500
  trailServer: 0xf97316, // orange-500
  trailInterpolated: 0x3b82f6, // blue-500
  trailRawServer: 0xa855f7, // purple-500
} as const;
