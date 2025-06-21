import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  AGSBinaryReader, 
  BinaryUtils 
} from '../room-format/binary-reader.js';
import { 
  RoomFileVersion, 
  RoomVersionDetector 
} from '../room-format/room-version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Binary Reader Component Tests', () => {
  let room2Buffer: Buffer;
  let room2Version: RoomFileVersion;

  before(async () => {
    const room2Path = path.join(__dirname, '../../room2.crm');
    try {
      room2Buffer = await fs.readFile(room2Path);
      room2Version = RoomVersionDetector.getRoomVersion(room2Buffer);
    } catch (error) {
      console.warn('room2.crm not available for testing');
    }
  });

  describe('AGSBinaryReader Construction', () => {
    test('should create reader with buffer and version', () => {
      const buffer = Buffer.alloc(100);
      const reader = new AGSBinaryReader(buffer, RoomFileVersion.kRoomVersion_360);
      
      assert.ok(reader instanceof AGSBinaryReader);
    });

    test('should create reader from room2.crm', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const reader = new AGSBinaryReader(room2Buffer, room2Version);
      assert.ok(reader instanceof AGSBinaryReader);
      console.log(`      ✓ Created reader for room version ${room2Version}`);
    });
  });

  describe('String Reading (AGS Format)', () => {
    test('should read length-prefixed string', () => {
      const buffer = Buffer.alloc(20);
      const testString = 'Hello';
      
      // Write length-prefixed string
      buffer.writeUInt32LE(testString.length, 0);
      buffer.write(testString, 4, 'utf-8');
      
      const reader = new AGSBinaryReader(buffer, RoomFileVersion.kRoomVersion_360);
      const result = reader.readString();
      
      assert.ok(result.success, 'Should successfully read string');
      assert.equal(result.value, testString);
    });

    test('should handle zero-length string', () => {
      const buffer = Buffer.alloc(8);
      buffer.writeUInt32LE(0, 0); // Zero length
      
      const reader = new AGSBinaryReader(buffer, RoomFileVersion.kRoomVersion_360);
      const result = reader.readString();
      
      assert.ok(result.success, 'Should handle zero-length string');
      assert.equal(result.value, '');
    });
  });

  describe('String Sequence Reading', () => {
    test('should read sequence of strings until zero terminator', () => {
      const buffer = Buffer.alloc(50);
      let offset = 0;
      
      // Write sequence: "First", "Second", then zero terminator
      const strings = ['First', 'Second'];
      
      for (const str of strings) {
        buffer.writeUInt32LE(str.length, offset);
        offset += 4;
        buffer.write(str, offset, 'utf-8');
        offset += str.length;
      }
      
      // Zero terminator
      buffer.writeUInt32LE(0, offset);
      
      const reader = new AGSBinaryReader(buffer, RoomFileVersion.kRoomVersion_360);
      const result = reader.readStringSequence(10);
      
      assert.deepEqual(result, strings);
    });
  });

  describe('Room Data Reading', () => {
    test('should read hotspot names from room2.crm', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const reader = new AGSBinaryReader(room2Buffer, room2Version);
      reader.setOffset(0x101); // Known hotspot offset
      
      const hotspotNames = reader.readStringSequence(50);
      
      assert.ok(hotspotNames.length > 0, 'Should find hotspot names');
      assert.ok(hotspotNames.length <= 50, 'Should not exceed AGS limit');
      
      console.log(`      ✓ Found ${hotspotNames.length} hotspot names`);
    });
  });

  describe('BinaryUtils Static Methods', () => {
    test('should validate string data correctly', () => {
      // Valid string data
      const validBuffer = Buffer.alloc(20);
      validBuffer.writeUInt32LE(5, 0);
      validBuffer.write('Hello', 4, 'utf-8');
      
      assert.ok(BinaryUtils.validateStringData(validBuffer, 0));
      
      // Invalid: length too large
      const invalidBuffer = Buffer.alloc(10);
      invalidBuffer.writeUInt32LE(1000, 0);
      
      assert.ok(!BinaryUtils.validateStringData(invalidBuffer, 0));
    });

    test('should provide utility functions', () => {
      // Test that BinaryUtils has the expected static methods
      assert.ok(typeof BinaryUtils.validateStringData === 'function', 'Should have validateStringData method');
      console.log('      ✓ BinaryUtils provides validation utilities');
    });
  });

  describe('Error Handling', () => {
    test('should handle reading from invalid offsets gracefully', () => {
      const buffer = Buffer.alloc(10);
      const reader = new AGSBinaryReader(buffer, RoomFileVersion.kRoomVersion_360);
      
      reader.setOffset(8);
      const result = reader.readString();
      assert.ok(!result.success, 'Should fail gracefully for invalid read');
    });

    test('should handle malformed string data', () => {
      const buffer = Buffer.alloc(10);
      buffer.writeUInt32LE(20, 0); // Length longer than buffer
      
      const reader = new AGSBinaryReader(buffer, RoomFileVersion.kRoomVersion_360);
      const result = reader.readString();
      
      assert.ok(!result.success, 'Should fail for malformed data');
    });
  });
});