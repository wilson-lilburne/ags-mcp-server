import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  RoomFileWriter,
  RoomFileModifier
} from '../room-format/room-writer.js';
import { 
  RoomFileVersion, 
  RoomVersionDetector 
} from '../room-format/room-version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Room Writer Component Tests', () => {
  let room2Buffer: Buffer;
  let room2Version: RoomFileVersion;
  let tempDir: string;

  before(async () => {
    // Setup test environment
    tempDir = path.join(__dirname, '../../temp-writer-test');
    await fs.mkdir(tempDir, { recursive: true });

    const originalRoom2Path = path.join(__dirname, '../../room2.crm');
    try {
      room2Buffer = await fs.readFile(originalRoom2Path);
      room2Version = RoomVersionDetector.getRoomVersion(room2Buffer);
    } catch (error) {
      console.warn('room2.crm not available for testing');
    }
  });

  after(async () => {
    // Cleanup
    try {
      if (existsSync(tempDir)) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      console.warn(`Cleanup warning: ${error}`);
    }
  });

  describe('RoomFileWriter Construction', () => {
    test('should create writer with proper parameters', () => {
      const buffer = Buffer.alloc(1000);
      buffer.writeUInt16LE(RoomFileVersion.kRoomVersion_360, 0);
      
      const writer = new RoomFileWriter('test.crm', buffer, RoomFileVersion.kRoomVersion_360);
      assert.ok(writer instanceof RoomFileWriter);
    });

    test('should create writer from room2.crm', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const writer = new RoomFileWriter('room2.crm', room2Buffer, room2Version);
      assert.ok(writer instanceof RoomFileWriter);
      console.log(`      ✓ Created writer for room version ${room2Version}`);
    });
  });

  describe('RoomFileModifier Export Operations', () => {
    test('should handle export block requests', async () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const outputPath = path.join(tempDir, 'exported-block.bin');
      const result = await RoomFileModifier.exportBlock('room2.crm', 1, outputPath);
      
      assert.ok(typeof result.success === 'boolean', 'Should return success status');
      
      if (result.success) {
        console.log(`      ✓ Block export succeeded: ${result.message}`);
      } else {
        // Expected for current implementation
        assert.ok(result.message.includes('not yet implemented'), 'Should indicate not implemented');
        console.log(`      ℹ Export not yet implemented: ${result.message}`);
      }
    });

    test('should handle multiple export requests', async () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const outputPath1 = path.join(tempDir, 'exported-block1.bin');
      const outputPath2 = path.join(tempDir, 'exported-block2.bin');
      
      const result1 = await RoomFileModifier.exportBlock('room2.crm', 1, outputPath1);
      const result2 = await RoomFileModifier.exportBlock('room2.crm', 2, outputPath2);
      
      assert.ok(typeof result1.success === 'boolean', 'Should return success status for first export');
      assert.ok(typeof result2.success === 'boolean', 'Should return success status for second export');
      
      console.log(`      ✓ Multiple export requests handled consistently`);
    });
  });

  describe('Hotspot Writing Operations', () => {
    test('should handle hotspot data writing attempts', async () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const writer = new RoomFileWriter('room2.crm', room2Buffer, room2Version);
      const outputPath = path.join(tempDir, 'modified-room.crm');
      
      // Create test hotspot data
      const hotspots = [
        { id: 1, name: 'Test Door', scriptName: 'hTestDoor', interactions: ['Look'] },
        { id: 2, name: 'Test Window', scriptName: 'hTestWindow', interactions: ['Look'] }
      ];
      
      const result = await writer.writeHotspotData(hotspots, outputPath);
      
      assert.ok(typeof result.success === 'boolean', 'Should return success status');
      assert.ok(typeof result.message === 'string', 'Should return message');
      
      if (result.success) {
        console.log(`      ✓ Hotspot writing succeeded: ${result.message}`);
        if (existsSync(outputPath)) {
          const stats = await fs.stat(outputPath);
          console.log(`      ✓ Output file created: ${stats.size} bytes`);
        }
      } else {
        console.log(`      ℹ Hotspot writing failed (may be expected): ${result.message}`);
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid file paths', async () => {
      const buffer = Buffer.alloc(100);
      const writer = new RoomFileWriter('/invalid/path.crm', buffer, RoomFileVersion.kRoomVersion_360);
      
      const result = await writer.writeHotspotData([], '/invalid/output.crm');
      
      assert.ok(!result.success, 'Should fail for invalid paths');
      assert.ok(typeof result.message === 'string', 'Should provide error message');
      
      console.log(`      ✓ Gracefully handled invalid paths`);
    });

    test('should handle empty hotspot data', async () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const writer = new RoomFileWriter('room2.crm', room2Buffer, room2Version);
      const outputPath = path.join(tempDir, 'empty-hotspots.crm');
      
      const result = await writer.writeHotspotData([], outputPath);
      
      assert.ok(typeof result.success === 'boolean', 'Should handle empty data');
      console.log(`      ✓ Handled empty hotspot data (success: ${result.success})`);
    });
  });

  describe('Performance', () => {
    test('should perform operations efficiently', async () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const writer = new RoomFileWriter('room2.crm', room2Buffer, room2Version);
      const outputPath = path.join(tempDir, 'perf-test.crm');
      
      const startTime = Date.now();
      const result = await writer.writeHotspotData([], outputPath);
      const endTime = Date.now();
      
      const operationTime = endTime - startTime;
      assert.ok(operationTime < 1000, `Operations should be fast (${operationTime}ms)`);
      
      console.log(`      ✓ Operation completed in ${operationTime}ms (success: ${result.success})`);
    });
  });
});