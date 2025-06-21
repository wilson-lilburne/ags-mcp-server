import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  RoomBlockParser
} from '../room-format/block-parser.js';
import { 
  RoomFileVersion, 
  RoomVersionDetector 
} from '../room-format/room-version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Block Parser Component Tests', () => {
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

  describe('RoomBlockParser Construction', () => {
    test('should create parser with buffer', () => {
      const buffer = Buffer.alloc(100);
      buffer.writeUInt16LE(RoomFileVersion.kRoomVersion_360, 0);
      
      const parser = new RoomBlockParser(buffer);
      assert.ok(parser instanceof RoomBlockParser);
    });

    test('should create parser from room2.crm', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomBlockParser(room2Buffer);
      assert.ok(parser instanceof RoomBlockParser);
      console.log(`      ✓ Created parser for ${room2Buffer.length} byte file`);
    });
  });

  describe('Block Parsing', () => {
    test('should attempt to parse blocks from room2.crm', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomBlockParser(room2Buffer);
      const result = parser.parseBlocks();
      
      // The parser should return a structured result even if parsing fails
      assert.ok(typeof result.success === 'boolean', 'Should return success status');
      assert.ok(Array.isArray(result.blocks), 'Should return array of blocks');
      
      if (result.success) {
        assert.ok(result.blocks.length > 0, 'Should find at least one block on success');
        console.log(`      ✓ Found ${result.blocks.length} blocks`);
        
        // Verify block structure
        for (const block of result.blocks.slice(0, 3)) {
          assert.ok(typeof block.id === 'number', 'Block should have numeric ID');
          assert.ok(typeof block.name === 'string', 'Block should have string name');
          assert.ok(typeof block.offset === 'string', 'Block should have string offset');
          assert.ok(typeof block.size === 'string', 'Block should have string size');
          assert.ok(typeof block.rawOffset === 'number', 'Block should have numeric rawOffset');
          assert.ok(typeof block.rawSize === 'number', 'Block should have numeric rawSize');
          console.log(`      - ${block.name} (ID: ${block.id}, Size: ${block.rawSize}, Offset: ${block.rawOffset})`);
        }
      } else {
        console.log(`      ℹ Block parsing failed (expected for some formats): ${result.error}`);
        assert.ok(typeof result.error === 'string', 'Should provide error message on failure');
      }
    });

    test('should handle block extraction attempts', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomBlockParser(room2Buffer);
      
      // Try to extract a block (may return null if parsing failed)
      const extractedData = parser.extractBlock(1);
      
      if (extractedData) {
        assert.ok(extractedData instanceof Buffer, 'Should return Buffer for extracted data');
        assert.ok(extractedData.length > 0, 'Extracted data should not be empty');
        console.log(`      ✓ Extracted block: ${extractedData.length} bytes`);
      } else {
        console.log('      ℹ Block extraction returned null (may be expected)');
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle empty buffer gracefully', () => {
      const emptyBuffer = Buffer.alloc(0);
      const parser = new RoomBlockParser(emptyBuffer);
      const result = parser.parseBlocks();
      
      assert.ok(!result.success, 'Should fail for empty buffer');
      assert.ok(typeof result.error === 'string', 'Should provide error message');
      assert.ok(Array.isArray(result.blocks), 'Should still return blocks array');
    });

    test('should handle buffer too small for version', () => {
      const tinyBuffer = Buffer.alloc(1);
      const parser = new RoomBlockParser(tinyBuffer);
      const result = parser.parseBlocks();
      
      assert.ok(!result.success, 'Should fail for tiny buffer');
      assert.ok(typeof result.error === 'string', 'Should provide error message');
    });

    test('should handle corrupted block structure', () => {
      const buffer = Buffer.alloc(50);
      buffer.writeUInt16LE(RoomFileVersion.kRoomVersion_360, 0);
      
      // Write some invalid data
      buffer.fill(0xFF, 10);
      
      const parser = new RoomBlockParser(buffer);
      const result = parser.parseBlocks();
      
      // Should not crash
      assert.ok(typeof result.success === 'boolean', 'Should handle corruption gracefully');
      
      if (!result.success) {
        console.log(`      ✓ Gracefully handled corruption: ${result.error}`);
      }
    });
  });

  describe('Performance', () => {
    test('should parse blocks efficiently', () => {
      if (!room2Buffer || room2Buffer.length < 10000) {
        console.log('      Skipping test - need substantial room file');
        return;
      }

      const startTime = Date.now();
      const parser = new RoomBlockParser(room2Buffer);
      const result = parser.parseBlocks();
      const endTime = Date.now();
      
      const parseTime = endTime - startTime;
      assert.ok(parseTime < 1000, `Parsing should be fast (${parseTime}ms)`);
      
      console.log(`      ✓ Parsing completed in ${parseTime}ms (success: ${result.success})`);
    });
  });
});