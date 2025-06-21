import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  RoomFileVersion, 
  RoomVersionDetector, 
  ROOM_FILE_CONSTANTS 
} from '../room-format/room-version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Room Version Detection Component Tests', () => {
  let room2Path: string;
  let room2Buffer: Buffer;

  before(async () => {
    room2Path = path.join(__dirname, '../../room2.crm');
    try {
      room2Buffer = await fs.readFile(room2Path);
    } catch (error) {
      console.warn('room2.crm not available for testing');
    }
  });

  describe('RoomFileVersion Enum', () => {
    test('should have expected version constants', () => {
      assert.equal(RoomFileVersion.kRoomVersion_250a, 4);
      assert.equal(RoomFileVersion.kRoomVersion_360, 33);
      assert.equal(RoomFileVersion.kRoomVersion_Current, RoomFileVersion.kRoomVersion_360);
    });

    test('should have reasonable version progression', () => {
      // Versions should increase over time
      assert.ok(RoomFileVersion.kRoomVersion_255 > RoomFileVersion.kRoomVersion_254);
      assert.ok(RoomFileVersion.kRoomVersion_300a > RoomFileVersion.kRoomVersion_272);
      assert.ok(RoomFileVersion.kRoomVersion_360 > RoomFileVersion.kRoomVersion_350);
    });
  });

  describe('ROOM_FILE_CONSTANTS', () => {
    test('should have expected AGS limits', () => {
      assert.equal(ROOM_FILE_CONSTANTS.MAX_ROOM_HOTSPOTS, 50);
      assert.equal(ROOM_FILE_CONSTANTS.MAX_ROOM_OBJECTS, 256);
      assert.equal(ROOM_FILE_CONSTANTS.MAX_ROOM_REGIONS, 16);
      assert.equal(ROOM_FILE_CONSTANTS.LEGACY_HOTSPOT_NAME_LEN, 30);
      assert.equal(ROOM_FILE_CONSTANTS.MAX_SCRIPT_NAME_LEN, 20);
    });

    test('should have data extension flags', () => {
      assert.equal(ROOM_FILE_CONSTANTS.kDataExt_NumID32, 0x01);
      assert.equal(ROOM_FILE_CONSTANTS.kDataExt_File64, 0x02);
    });
  });

  describe('RoomVersionDetector.getRoomVersion()', () => {
    test('should throw error for buffer too small', () => {
      const smallBuffer = Buffer.alloc(1);
      assert.throws(
        () => RoomVersionDetector.getRoomVersion(smallBuffer),
        /Buffer too small to contain room version/
      );
    });

    test('should throw error for invalid version', () => {
      const invalidBuffer = Buffer.alloc(4);
      invalidBuffer.writeUInt16LE(999, 0); // Invalid version
      assert.throws(
        () => RoomVersionDetector.getRoomVersion(invalidBuffer),
        /Unknown room file version: 999/
      );
    });

    test('should read valid version from room2.crm', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const version = RoomVersionDetector.getRoomVersion(room2Buffer);
      assert.ok(version >= RoomFileVersion.kRoomVersion_250a, 'Version should be >= minimum');
      assert.ok(version <= RoomFileVersion.kRoomVersion_Current, 'Version should be <= current');
      console.log(`      ✓ Detected room version: ${version}`);
    });

    test('should handle various valid version numbers', () => {
      const testVersions = [
        RoomFileVersion.kRoomVersion_250a,
        RoomFileVersion.kRoomVersion_300a,
        RoomFileVersion.kRoomVersion_350,
        RoomFileVersion.kRoomVersion_360
      ];

      for (const testVersion of testVersions) {
        const buffer = Buffer.alloc(4);
        buffer.writeUInt16LE(testVersion, 0);
        
        const detectedVersion = RoomVersionDetector.getRoomVersion(buffer);
        assert.equal(detectedVersion, testVersion, `Should detect version ${testVersion}`);
      }
    });
  });

  describe('RoomVersionDetector Feature Detection', () => {
    test('should correctly detect script name support', () => {
      // Older versions don't support script names
      assert.equal(
        RoomVersionDetector.supportsScriptNames(RoomFileVersion.kRoomVersion_250a), 
        false
      );
      assert.equal(
        RoomVersionDetector.supportsScriptNames(RoomFileVersion.kRoomVersion_255), 
        false
      );

      // Version 270+ supports script names
      assert.equal(
        RoomVersionDetector.supportsScriptNames(RoomFileVersion.kRoomVersion_270), 
        true
      );
      assert.equal(
        RoomVersionDetector.supportsScriptNames(RoomFileVersion.kRoomVersion_360), 
        true
      );
    });

    test('should correctly detect modern string format', () => {
      // Older versions don't use modern strings
      assert.equal(
        RoomVersionDetector.usesModernStringFormat(RoomFileVersion.kRoomVersion_300a), 
        false
      );
      assert.equal(
        RoomVersionDetector.usesModernStringFormat(RoomFileVersion.kRoomVersion_314), 
        false
      );

      // Version 3415+ uses modern strings
      assert.equal(
        RoomVersionDetector.usesModernStringFormat(RoomFileVersion.kRoomVersion_3415), 
        true
      );
      assert.equal(
        RoomVersionDetector.usesModernStringFormat(RoomFileVersion.kRoomVersion_360), 
        true
      );
    });

    test('should correctly detect legacy string format', () => {
      // Early versions use legacy strings
      assert.equal(
        RoomVersionDetector.usesLegacyStringFormat(RoomFileVersion.kRoomVersion_250a), 
        true
      );
      assert.equal(
        RoomVersionDetector.usesLegacyStringFormat(RoomFileVersion.kRoomVersion_300a), 
        true
      );

      // Version 303a+ doesn't use legacy format
      assert.equal(
        RoomVersionDetector.usesLegacyStringFormat(RoomFileVersion.kRoomVersion_303a), 
        false
      );
      assert.equal(
        RoomVersionDetector.usesLegacyStringFormat(RoomFileVersion.kRoomVersion_360), 
        false
      );
    });
  });

  describe('RoomVersionDetector.getParsingParams()', () => {
    test('should return correct parameters for version 250a', () => {
      const params = RoomVersionDetector.getParsingParams(RoomFileVersion.kRoomVersion_250a);
      
      assert.equal(params.supportsScriptNames, false);
      assert.equal(params.usesModernStrings, false);
      assert.equal(params.usesLegacyStrings, true);
      assert.equal(params.hotspotNameLength, 30);
      assert.equal(params.scriptNameLength, 20);
    });

    test('should return correct parameters for version 300a', () => {
      const params = RoomVersionDetector.getParsingParams(RoomFileVersion.kRoomVersion_300a);
      
      assert.equal(params.supportsScriptNames, true); // 300a >= 270
      assert.equal(params.usesModernStrings, false);
      assert.equal(params.usesLegacyStrings, true); // 300a < 303a
      assert.equal(params.hotspotNameLength, 30); // Legacy format
      assert.equal(params.scriptNameLength, 20); // Legacy format
    });

    test('should return correct parameters for version 360', () => {
      const params = RoomVersionDetector.getParsingParams(RoomFileVersion.kRoomVersion_360);
      
      assert.equal(params.supportsScriptNames, true);
      assert.equal(params.usesModernStrings, true); // 360 >= 3415
      assert.equal(params.usesLegacyStrings, false);
      assert.equal(params.hotspotNameLength, -1);
      assert.equal(params.scriptNameLength, -1);
    });

    test('should return correct parameters for room2.crm', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const version = RoomVersionDetector.getRoomVersion(room2Buffer);
      const params = RoomVersionDetector.getParsingParams(version);
      
      // Should have all expected properties
      assert.ok(typeof params.supportsScriptNames === 'boolean');
      assert.ok(typeof params.usesModernStrings === 'boolean');
      assert.ok(typeof params.usesLegacyStrings === 'boolean');
      assert.ok(typeof params.hotspotNameLength === 'number');
      assert.ok(typeof params.scriptNameLength === 'number');
      
      console.log(`      ✓ Parsing params for v${version}:`, params);
    });
  });

  describe('Version Validation Edge Cases', () => {
    test('should handle minimum valid version', () => {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt16LE(RoomFileVersion.kRoomVersion_250a, 0);
      
      const version = RoomVersionDetector.getRoomVersion(buffer);
      assert.equal(version, RoomFileVersion.kRoomVersion_250a);
    });

    test('should handle maximum valid version', () => {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt16LE(RoomFileVersion.kRoomVersion_Current, 0);
      
      const version = RoomVersionDetector.getRoomVersion(buffer);
      assert.equal(version, RoomFileVersion.kRoomVersion_Current);
    });

    test('should reject version below minimum', () => {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt16LE(RoomFileVersion.kRoomVersion_250a - 1, 0);
      
      assert.throws(
        () => RoomVersionDetector.getRoomVersion(buffer),
        /Unknown room file version/
      );
    });

    test('should reject version above maximum', () => {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt16LE(RoomFileVersion.kRoomVersion_Current + 1, 0);
      
      assert.throws(
        () => RoomVersionDetector.getRoomVersion(buffer),
        /Unknown room file version/
      );
    });
  });

  describe('Buffer Handling', () => {
    test('should handle buffers larger than needed', () => {
      const largeBuffer = Buffer.alloc(1000);
      largeBuffer.writeUInt16LE(RoomFileVersion.kRoomVersion_360, 0);
      
      const version = RoomVersionDetector.getRoomVersion(largeBuffer);
      assert.equal(version, RoomFileVersion.kRoomVersion_360);
    });

    test('should handle exactly minimum buffer size', () => {
      const minBuffer = Buffer.alloc(2);
      minBuffer.writeUInt16LE(RoomFileVersion.kRoomVersion_300a, 0);
      
      const version = RoomVersionDetector.getRoomVersion(minBuffer);
      assert.equal(version, RoomFileVersion.kRoomVersion_300a);
    });

    test('should read little-endian correctly', () => {
      const buffer = Buffer.alloc(4);
      // Version 33 = 0x0021 in little-endian = [0x21, 0x00]
      buffer[0] = 0x21;
      buffer[1] = 0x00;
      
      const version = RoomVersionDetector.getRoomVersion(buffer);
      assert.equal(version, 33);
    });
  });
});