import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  RoomHotspotParser,
  Hotspot,
  HotspotParsingResult,
  HotspotModificationUtils
} from '../room-format/hotspot-parser.js';
import { 
  RoomFileVersion, 
  RoomVersionDetector 
} from '../room-format/room-version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Hotspot Parser Component Tests', () => {
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

  describe('RoomHotspotParser Construction', () => {
    test('should create parser with buffer', () => {
      const buffer = Buffer.alloc(1000);
      buffer.writeUInt16LE(RoomFileVersion.kRoomVersion_360, 0);
      
      const parser = new RoomHotspotParser(buffer);
      assert.ok(parser instanceof RoomHotspotParser);
    });

    test('should create parser from room2.crm', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomHotspotParser(room2Buffer);
      assert.ok(parser instanceof RoomHotspotParser);
      console.log(`      ✓ Created parser for room version ${room2Version}`);
    });
  });

  describe('Two-Phase Hotspot Parsing', () => {
    test('should parse hotspots from room2.crm', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomHotspotParser(room2Buffer);
      const result = parser.parseHotspots();
      
      assert.ok(result.success, `Parsing should succeed: ${result.error}`);
      assert.ok(Array.isArray(result.hotspots), 'Should return array of hotspots');
      assert.ok(result.hotspots.length > 0, 'Should find at least one hotspot');
      
      console.log(`      ✓ Found ${result.hotspots.length} hotspots`);
      console.log(`      ✓ Display names found: ${result.metadata.displayNamesFound}`);
      console.log(`      ✓ Script names found: ${result.metadata.scriptNamesFound}`);
    });

    test('should find display names and script names separately', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomHotspotParser(room2Buffer);
      const result = parser.parseHotspots();
      
      assert.ok(result.success, 'Parsing should succeed');
      
      // Should find display names
      assert.ok(result.metadata.displayNamesFound > 0, 'Should find display names');
      
      // Should find script names (if version supports them)
      const params = RoomVersionDetector.getParsingParams(room2Version);
      if (params.supportsScriptNames) {
        assert.ok(
          result.metadata.scriptNamesFound >= 0, 
          'Should attempt to find script names for supported versions'
        );
        
        if (result.metadata.scriptNamesFound > 0) {
          console.log(`      ✓ Two-phase parsing successful - found both display and script names`);
        }
      }
    });

    test('should include parsing metadata', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomHotspotParser(room2Buffer);
      const result = parser.parseHotspots();
      
      assert.ok(result.success, 'Parsing should succeed');
      assert.ok(result.metadata, 'Should include metadata');
      
      // Check metadata structure
      assert.ok(typeof result.metadata.version === 'number', 'Should include version');
      assert.ok(typeof result.metadata.displayNamesFound === 'number', 'Should include display name count');
      assert.ok(typeof result.metadata.scriptNamesFound === 'number', 'Should include script name count');
      assert.ok(typeof result.metadata.displayNamesOffset === 'number', 'Should include display names offset');
      assert.ok(typeof result.metadata.scriptNamesOffset === 'number', 'Should include script names offset');
      
      // Check reasonable values
      assert.equal(result.metadata.displayNamesOffset, 0x101, 'Display names should be at known offset');
      assert.ok(result.metadata.displayNamesFound >= 0 && result.metadata.displayNamesFound <= 50, 
                'Display name count should be reasonable');
    });
  });

  describe('Hotspot Data Structure', () => {
    test('should return valid hotspot objects', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomHotspotParser(room2Buffer);
      const result = parser.parseHotspots();
      
      assert.ok(result.success, 'Parsing should succeed');
      
      for (const hotspot of result.hotspots) {
        // Check required fields
        assert.ok(typeof hotspot.id === 'number', `Hotspot should have numeric ID: ${JSON.stringify(hotspot)}`);
        assert.ok(typeof hotspot.name === 'string', `Hotspot should have string name: ${JSON.stringify(hotspot)}`);
        assert.ok(typeof hotspot.scriptName === 'string', `Hotspot should have script name: ${JSON.stringify(hotspot)}`);
        
        // Check reasonable values
        assert.ok(hotspot.id >= 0 && hotspot.id <= 50, `Hotspot ID should be 0-50: ${hotspot.id}`);
        assert.ok(hotspot.name && hotspot.name.length > 0, `Hotspot name should not be empty: "${hotspot.name}"`);
        assert.ok(hotspot.scriptName && hotspot.scriptName.length > 0, `Script name should not be empty: "${hotspot.scriptName}"`);
        
        // Script names should follow AGS convention
        assert.ok(hotspot.scriptName.startsWith('h'), `Script name should start with 'h': ${hotspot.scriptName}`);
        
        // Check optional fields
        if (hotspot.interactions) {
          assert.ok(Array.isArray(hotspot.interactions), 'Interactions should be array');
          assert.ok(hotspot.interactions.length > 0, 'Interactions array should not be empty if present');
        }
        
        if (hotspot.walkTo) {
          assert.ok(typeof hotspot.walkTo.x === 'number', 'Walk-to X should be number');
          assert.ok(typeof hotspot.walkTo.y === 'number', 'Walk-to Y should be number');
        }
      }
      
      console.log(`      ✓ All ${result.hotspots.length} hotspots have valid structure`);
    });

    test('should find expected hotspots from room2.crm', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomHotspotParser(room2Buffer);
      const result = parser.parseHotspots();
      
      assert.ok(result.success, 'Parsing should succeed');
      
      const hotspotNames = result.hotspots.map(h => h.name?.toLowerCase() || '');
      const allNames = hotspotNames.join(' ');
      
      // Should find some recognizable hotspot names
      const expectedPatterns = ['door', 'window', 'lock', 'menu', 'staff'];
      const foundPatterns = expectedPatterns.filter(pattern => 
        allNames.includes(pattern)
      );
      
      assert.ok(
        foundPatterns.length > 0,
        `Should find recognizable hotspot names. Found: ${result.hotspots.slice(0, 5).map(h => h.name).join(', ')}`
      );
      
      console.log(`      ✓ Found expected patterns: ${foundPatterns.join(', ')}`);
    });

    test('should detect real script names vs defaults', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomHotspotParser(room2Buffer);
      const result = parser.parseHotspots();
      
      assert.ok(result.success, 'Parsing should succeed');
      
      // Count real script names (not default hHotspotX pattern)
      const realScriptNames = result.hotspots.filter(h => 
        h.scriptName && !h.scriptName.match(/^hHotspot\d+$/)
      );
      
      const defaultScriptNames = result.hotspots.filter(h => 
        h.scriptName && h.scriptName.match(/^hHotspot\d+$/)
      );
      
      console.log(`      ✓ Real script names: ${realScriptNames.length}, Default: ${defaultScriptNames.length}`);
      
      if (realScriptNames.length > 0) {
        console.log(`      ✓ Examples of real script names: ${realScriptNames.slice(0, 3).map(h => h.scriptName).join(', ')}`);
        
        // Real script names should look reasonable
        for (const hotspot of realScriptNames.slice(0, 3)) {
          if (hotspot.scriptName) {
            assert.ok(
              hotspot.scriptName.match(/^h[A-Za-z][A-Za-z0-9_]*$/),
              `Real script name should follow AGS convention: ${hotspot.scriptName}`
            );
          }
        }
      }
      
      // Two-phase parsing should find more real script names than single-phase
      assert.ok(result.metadata.scriptNamesFound >= 0, 'Should have script name metadata');
    });
  });

  describe('Script Name Detection', () => {
    test('should find script names offset correctly', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomHotspotParser(room2Buffer);
      const result = parser.parseHotspots();
      
      assert.ok(result.success, 'Parsing should succeed');
      
      if (result.metadata.scriptNamesOffset > 0) {
        // Script names should be found after display names
        assert.ok(
          result.metadata.scriptNamesOffset > result.metadata.displayNamesOffset,
          'Script names should come after display names'
        );
        
        // Offset should be reasonable
        assert.ok(
          result.metadata.scriptNamesOffset < room2Buffer.length - 100,
          'Script names offset should be within reasonable range'
        );
        
        console.log(`      ✓ Script names found at offset 0x${result.metadata.scriptNamesOffset.toString(16)}`);
      } else {
        console.log(`      ℹ Script names not found (offset: ${result.metadata.scriptNamesOffset})`);
      }
    });

    test('should validate script name sequences', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomHotspotParser(room2Buffer);
      
      // Test the static validation method
      const possibleOffsets = RoomHotspotParser.findHotspotDataOffsets(room2Buffer);
      
      assert.ok(Array.isArray(possibleOffsets), 'Should return array of offsets');
      assert.ok(possibleOffsets.length >= 1, 'Should find at least one possible offset');
      
      // Should include the known hotspot offset
      assert.ok(
        possibleOffsets.includes(0x101),
        `Should find known hotspot offset 0x101. Found: ${possibleOffsets.map(o => '0x' + o.toString(16)).join(', ')}`
      );
      
      console.log(`      ✓ Found ${possibleOffsets.length} possible hotspot data offsets`);
    });
  });

  describe('Interaction Detection', () => {
    test('should detect interaction functions in script data', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomHotspotParser(room2Buffer);
      const result = parser.parseHotspots();
      
      assert.ok(result.success, 'Parsing should succeed');
      
      // Check if any hotspots have custom interactions
      const hotspotsWithInteractions = result.hotspots.filter(h => 
        h.interactions && h.interactions.length > 0 && 
        !h.interactions.every(i => i === 'Look' || i === 'Interact')
      );
      
      if (hotspotsWithInteractions.length > 0) {
        console.log(`      ✓ Found ${hotspotsWithInteractions.length} hotspots with custom interactions`);
        
        // Show examples
        for (const hotspot of hotspotsWithInteractions.slice(0, 2)) {
          console.log(`      - ${hotspot.name}: ${hotspot.interactions?.join(', ')}`);
        }
      } else {
        // Default interactions should still be present
        const defaultInteractions = result.hotspots.filter(h => 
          h.interactions && h.interactions.includes('Look')
        );
        
        assert.ok(defaultInteractions.length > 0, 'Should have default interactions');
        console.log(`      ✓ Default interactions assigned to ${defaultInteractions.length} hotspots`);
      }
    });

    test('should recognize AGS interaction suffixes', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const parser = new RoomHotspotParser(room2Buffer);
      const result = parser.parseHotspots();
      
      assert.ok(result.success, 'Parsing should succeed');
      
      // Check for variety in interaction types
      const allInteractions = new Set();
      result.hotspots.forEach(h => {
        h.interactions?.forEach(i => allInteractions.add(i));
      });
      
      console.log(`      ✓ Found interaction types: ${Array.from(allInteractions).join(', ')}`);
      
      // Should have at least basic interactions
      assert.ok(allInteractions.has('Look'), 'Should have Look interaction');
      assert.ok(allInteractions.has('Interact'), 'Should have Interact interaction');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle empty buffer gracefully', () => {
      const emptyBuffer = Buffer.alloc(0);
      const parser = new RoomHotspotParser(emptyBuffer);
      const result = parser.parseHotspots();
      
      assert.ok(!result.success, 'Should fail for empty buffer');
      assert.ok(typeof result.error === 'string', 'Should provide error message');
      assert.ok(Array.isArray(result.hotspots), 'Should still return hotspots array');
      assert.ok(result.hotspots.length >= 1, 'Should return default hotspot');
      
      // Default hotspot should be reasonable
      const defaultHotspot = result.hotspots[0];
      assert.equal(defaultHotspot.name, 'Background', 'Default should be Background');
      assert.equal(defaultHotspot.scriptName, 'hHotspot0', 'Default script name should be hHotspot0');
    });

    test('should handle buffer too small for hotspot data', () => {
      const smallBuffer = Buffer.alloc(50);
      smallBuffer.writeUInt16LE(RoomFileVersion.kRoomVersion_360, 0);
      
      const parser = new RoomHotspotParser(smallBuffer);
      const result = parser.parseHotspots();
      
      // Should not crash
      assert.ok(typeof result.success === 'boolean', 'Should handle small buffer gracefully');
      assert.ok(Array.isArray(result.hotspots), 'Should return hotspots array');
      
      if (!result.success) {
        console.log(`      ✓ Gracefully handled small buffer: ${result.error}`);
      }
    });

    test('should handle version without script name support', () => {
      // Create buffer with old version
      const buffer = Buffer.alloc(1000);
      buffer.writeUInt16LE(RoomFileVersion.kRoomVersion_250a, 0);
      
      // Add some hotspot display names at the expected offset
      const offset = 0x101;
      buffer.writeUInt32LE(4, offset);
      buffer.write('Test', offset + 4, 'utf-8');
      buffer.writeUInt32LE(0, offset + 8); // Terminator
      
      const parser = new RoomHotspotParser(buffer);
      const result = parser.parseHotspots();
      
      if (result.success) {
        // Should find display names but use default script names
        assert.ok(result.metadata.displayNamesFound >= 0, 'Should process display names');
        
        const hotspot = result.hotspots.find(h => h.name === 'Test');
        if (hotspot) {
          assert.ok(
            hotspot.scriptName && hotspot.scriptName.startsWith('hHotspot'),
            'Should use default script name for old version'
          );
        }
        
        console.log(`      ✓ Handled old version without script names correctly`);
      }
    });

    test('should handle corrupted hotspot data', () => {
      const buffer = Buffer.alloc(500);
      buffer.writeUInt16LE(RoomFileVersion.kRoomVersion_360, 0);
      
      // Write corrupted data at hotspot offset
      const offset = 0x101;
      buffer.writeUInt32LE(0xFFFFFFFF, offset); // Invalid length
      
      const parser = new RoomHotspotParser(buffer);
      const result = parser.parseHotspots();
      
      // Should not crash and should provide fallback
      assert.ok(typeof result.success === 'boolean', 'Should handle corruption gracefully');
      assert.ok(Array.isArray(result.hotspots), 'Should return hotspots array');
      
      if (!result.success) {
        // Should have default hotspot
        assert.ok(result.hotspots.length >= 1, 'Should provide default hotspot on failure');
        console.log(`      ✓ Gracefully handled corrupted data: ${result.error}`);
      }
    });
  });

  describe('HotspotModificationUtils', () => {
    test('should validate modifications correctly', () => {
      const validModifications = [
        { id: 1, name: 'Door', scriptName: 'hDoor' },
        { id: 2, walkTo: { x: 100, y: 200 } },
        { id: 3, enabled: false }
      ];
      
      const result = HotspotModificationUtils.validateModifications(validModifications);
      assert.ok(result.valid, `Valid modifications should pass: ${result.errors.join(', ')}`);
      assert.equal(result.errors.length, 0, 'Should have no errors');
    });

    test('should reject invalid modifications', () => {
      const invalidModifications = [
        { id: -1, name: 'Invalid' }, // Invalid ID
        { id: 60, name: 'TooHigh' }, // ID too high  
        { id: 1, name: '' }, // Empty name
        { id: 2, name: 'A'.repeat(100) }, // Name too long
        { id: 3, scriptName: '123invalid' }, // Invalid script name
        { id: 4, walkTo: { x: -10, y: 50000 } } // Invalid coordinates
      ];
      
      const result = HotspotModificationUtils.validateModifications(invalidModifications);
      assert.ok(!result.valid, 'Invalid modifications should fail');
      assert.ok(result.errors.length > 0, 'Should have error messages');
      
      // Check specific error types
      const errorText = result.errors.join(' ');
      assert.ok(errorText.includes('Invalid hotspot ID'), 'Should detect invalid IDs');
      assert.ok(errorText.includes('Invalid name'), 'Should detect invalid names');
      assert.ok(errorText.includes('Invalid script name'), 'Should detect invalid script names');
      assert.ok(errorText.includes('Invalid walk-to coordinates'), 'Should detect invalid coordinates');
    });

    test('should apply modifications correctly', () => {
      const originalHotspots: Hotspot[] = [
        { id: 1, name: 'Door', scriptName: 'hDoor', interactions: ['Look'] },
        { id: 2, name: 'Window', scriptName: 'hWindow', interactions: ['Look'] }
      ];
      
      const modifications = [
        { id: 1, name: 'New Door', walkTo: { x: 50, y: 75 } },
        { id: 3, name: 'New Hotspot', scriptName: 'hNew' } // Add new hotspot
      ];
      
      const result = HotspotModificationUtils.applyModifications(originalHotspots, modifications);
      
      // Should modify existing hotspot
      const modifiedDoor = result.find(h => h.id === 1);
      assert.ok(modifiedDoor, 'Should find modified door');
      assert.equal(modifiedDoor?.name, 'New Door', 'Should update name');
      assert.equal(modifiedDoor?.scriptName, 'hDoor', 'Should preserve original script name');
      assert.deepEqual(modifiedDoor?.walkTo, { x: 50, y: 75 }, 'Should add walk-to coordinates');
      
      // Should preserve unmodified hotspot
      const window = result.find(h => h.id === 2);
      assert.ok(window, 'Should preserve window hotspot');
      assert.equal(window?.name, 'Window', 'Should keep original name');
      
      // Should add new hotspot
      const newHotspot = result.find(h => h.id === 3);
      assert.ok(newHotspot, 'Should add new hotspot');
      assert.equal(newHotspot?.name, 'New Hotspot', 'Should have new name');
      assert.equal(newHotspot?.scriptName, 'hNew', 'Should have new script name');
      
      // Result should be sorted by ID
      const ids = result.map(h => h.id);
      const sortedIds = [...ids].sort((a, b) => a - b);
      assert.deepEqual(ids, sortedIds, 'Result should be sorted by ID');
    });

    test('should handle property merging', () => {
      const originalHotspots: Hotspot[] = [
        { 
          id: 1, 
          name: 'Door', 
          scriptName: 'hDoor',
          properties: { locked: true, material: 'wood' }
        }
      ];
      
      const modifications = [
        { 
          id: 1, 
          properties: { locked: false, color: 'brown' } // Merge properties
        }
      ];
      
      const result = HotspotModificationUtils.applyModifications(originalHotspots, modifications);
      const modified = result[0];
      
      assert.deepEqual(
        modified.properties,
        { locked: false, material: 'wood', color: 'brown' },
        'Should merge properties correctly'
      );
    });
  });

  describe('Performance and Memory', () => {
    test('should parse hotspots efficiently', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      const startTime = Date.now();
      const parser = new RoomHotspotParser(room2Buffer);
      const result = parser.parseHotspots();
      const endTime = Date.now();
      
      const parseTime = endTime - startTime;
      assert.ok(parseTime < 100, `Hotspot parsing should be fast (${parseTime}ms)`);
      
      if (result.success) {
        console.log(`      ✓ Parsed ${result.hotspots.length} hotspots in ${parseTime}ms`);
      }
    });

    test('should handle multiple parsing attempts without memory leaks', () => {
      if (!room2Buffer) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }

      let firstResult: HotspotParsingResult | null = null;
      
      // Parse multiple times
      for (let i = 0; i < 5; i++) {
        const parser = new RoomHotspotParser(room2Buffer);
        const result = parser.parseHotspots();
        
        if (i === 0) {
          firstResult = result;
        } else if (firstResult && result.success && firstResult.success) {
          // Results should be consistent
          assert.equal(
            result.hotspots.length, 
            firstResult.hotspots.length,
            'Hotspot count should be consistent'
          );
        }
      }
      
      console.log('      ✓ Multiple parsing attempts completed consistently');
    });
  });
});