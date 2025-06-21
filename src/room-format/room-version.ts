/**
 * AGS Room File Version Detection and Constants
 * Based on AGS source code room_version.h
 */

export enum RoomFileVersion {
  kRoomVersion_250a = 4,
  kRoomVersion_250b = 5,
  kRoomVersion_251 = 6,
  kRoomVersion_253 = 7,
  kRoomVersion_254 = 8,
  kRoomVersion_255 = 9,
  kRoomVersion_255b = 10,
  kRoomVersion_256 = 11,
  kRoomVersion_261 = 12,
  kRoomVersion_262 = 13,
  kRoomVersion_270 = 14,
  kRoomVersion_272 = 15,
  kRoomVersion_300a = 16,
  kRoomVersion_300b = 17,
  kRoomVersion_303a = 18,
  kRoomVersion_303b = 19,
  kRoomVersion_314 = 20,
  kRoomVersion_3404 = 21,
  kRoomVersion_3405 = 22,
  kRoomVersion_341 = 23,
  kRoomVersion_3415 = 24,
  kRoomVersion_350 = 25,
  kRoomVersion_360 = 33,  // Based on our test file
  kRoomVersion_Current = kRoomVersion_360
}

export enum RoomFileBlock {
  kRoomFblk_Main = 1,           // Main room data
  kRoomFblk_Script = 2,         // Room script text source  
  kRoomFblk_CompScript = 3,     // Old compiled script
  kRoomFblk_CompScript2 = 4,    // Old compiled script  
  kRoomFblk_ObjectNames = 5,    // Names of room objects
  kRoomFblk_AnimBg = 6,         // Secondary room backgrounds
  kRoomFblk_CompScript3 = 7,    // Contemporary compiled script
  kRoomFblk_Properties = 8,     // Custom properties
  kRoomFblk_ObjectScNames = 9,  // Script names of room objects
  kRoomFile_EOF = 0xFF,         // End marker
}

export const ROOM_FILE_CONSTANTS = {
  MAX_ROOM_HOTSPOTS: 50,
  MAX_ROOM_OBJECTS: 256,
  MAX_ROOM_REGIONS: 16,
  MAX_WALK_AREAS: 16,
  MAX_WALK_BEHINDS: 16,
  LEGACY_HOTSPOT_NAME_LEN: 30,
  MAX_SCRIPT_NAME_LEN: 20,
  
  // Data extension format flags
  kDataExt_NumID32: 0x01,    // Use 32-bit block IDs
  kDataExt_File64: 0x02,     // Use 64-bit file offsets
} as const;

/**
 * AGS Room Version Detection Utility
 */
export class RoomVersionDetector {
  /**
   * Read room file version from buffer
   */
  static getRoomVersion(data: Buffer): RoomFileVersion {
    if (data.length < 2) {
      throw new Error('Buffer too small to contain room version');
    }
    
    const version = data.readUInt16LE(0);
    
    // Validate version is within known range
    if (version < RoomFileVersion.kRoomVersion_250a || 
        version > RoomFileVersion.kRoomVersion_Current) {
      throw new Error(`Unknown room file version: ${version}`);
    }
    
    return version as RoomFileVersion;
  }

  /**
   * Check if version supports specific features
   */
  static supportsScriptNames(version: RoomFileVersion): boolean {
    return version >= RoomFileVersion.kRoomVersion_270;
  }

  static usesModernStringFormat(version: RoomFileVersion): boolean {
    return version >= RoomFileVersion.kRoomVersion_3415;
  }

  static usesLegacyStringFormat(version: RoomFileVersion): boolean {
    return version < RoomFileVersion.kRoomVersion_303a;
  }

  /**
   * Get version-specific parsing parameters
   */
  static getParsingParams(version: RoomFileVersion) {
    return {
      supportsScriptNames: this.supportsScriptNames(version),
      usesModernStrings: this.usesModernStringFormat(version),
      usesLegacyStrings: this.usesLegacyStringFormat(version),
      hotspotNameLength: this.usesLegacyStringFormat(version) ? 
        ROOM_FILE_CONSTANTS.LEGACY_HOTSPOT_NAME_LEN : -1,
      scriptNameLength: this.usesLegacyStringFormat(version) ? 
        ROOM_FILE_CONSTANTS.MAX_SCRIPT_NAME_LEN : -1
    };
  }
}