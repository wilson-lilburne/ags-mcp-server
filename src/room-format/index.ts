/**
 * AGS Room Format Module
 * Component-based architecture for AGS room file manipulation
 */

// Version and constants
export * from './room-version.js';

// Binary reading utilities
export * from './binary-reader.js';

// Block structure parsing
export * from './block-parser.js';

// Hotspot parsing and management
export * from './hotspot-parser.js';

// Room file writing
export * from './room-writer.js';

// Re-export main types for convenience
export type {
  RoomBlock,
  BlockParsingResult
} from './block-parser.js';

export type {
  Hotspot,
  HotspotParsingResult
} from './hotspot-parser.js';

export type {
  WriteResult,
  WriteOptions
} from './room-writer.js';

export type {
  StringReadResult,
  BinaryParsingOptions
} from './binary-reader.js';