import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGSCrmManagerV2 } from '../ags-crm-manager-v2.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 2: Enhanced Hotspot Operations Tests', () => {
  let testDataDir: string;
  let tempDir: string;
  let room2Path: string;
  let manager: AGSCrmManagerV2;

  before(async () => {
    // Setup test environment
    testDataDir = path.join(__dirname, '../../test-data');
    tempDir = path.join(__dirname, '../../temp-test-phase2');
    const originalRoom2 = path.join(__dirname, '../../room2.crm');

    // Create test directories
    await fs.mkdir(testDataDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });

    // Create a working copy for testing (to avoid modifying the original)
    room2Path = path.join(tempDir, 'room2-test.crm');
    await fs.copyFile(originalRoom2, room2Path);

    // Initialize CRM manager v2
    manager = new AGSCrmManagerV2({ silent: true });
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

  describe('Advanced Hotspot Property Modification', () => {
    test('should modify hotspot properties with valid input', async () => {
      const modifications = [
        {
          id: 0,
          name: 'Main Entrance',
          scriptName: 'hMainEntrance',
          walkTo: { x: 150, y: 200 },
          enabled: true,
          description: 'The main entrance to the building'
        }
      ];

      const result = await manager.modifyHotspotProperties(room2Path, modifications);
      
      assert.ok(!result.isError, `Should not error: ${result.message}`);
      assert.ok(result.content.includes('Successfully modified 1 hotspot'), 'Should indicate successful modification');
      assert.ok(result.content.includes('Main Entrance'), 'Should include new name');
      assert.ok(result.content.includes('hMainEntrance'), 'Should include new script name');
      assert.ok(result.content.includes('150'), 'Should include new coordinates');
    });

    test('should validate hotspot ID range', async () => {
      const modifications = [{ id: 100, name: 'Invalid Hotspot' }];

      const result = await manager.modifyHotspotProperties(room2Path, modifications);
      
      assert.ok(result.isError, 'Should error with invalid ID');
      assert.ok(result.content.includes('Invalid hotspot ID: 100'), 'Should specify invalid ID');
    });

    test('should validate script name format', async () => {
      const modifications = [{ id: 0, scriptName: '123InvalidName' }];

      const result = await manager.modifyHotspotProperties(room2Path, modifications);
      
      assert.ok(result.isError, 'Should error with invalid script name');
      assert.ok(result.content.includes('must be valid identifier'), 'Should specify identifier requirement');
    });

    test('should validate coordinate ranges', async () => {
      const modifications = [{ id: 0, walkTo: { x: -10, y: 20000 } }];

      const result = await manager.modifyHotspotProperties(room2Path, modifications);
      
      assert.ok(result.isError, 'Should error with invalid coordinates');
      assert.ok(result.content.includes('Invalid walk-to coordinates'), 'Should specify coordinate error');
    });

    test('should handle multiple modifications', async () => {
      const modifications = [
        { id: 0, name: 'Door A' },
        { id: 1, name: 'Door B' },
        { id: 2, walkTo: { x: 100, y: 100 } }
      ];

      const result = await manager.modifyHotspotProperties(room2Path, modifications);
      
      assert.ok(!result.isError, 'Should not error with valid modifications');
      assert.ok(result.content.includes('Successfully modified 3 hotspot'), 'Should handle multiple modifications');
    });
  });

  describe('Walk-To Coordinate Updates', () => {
    test('should update walk-to coordinates for multiple hotspots', async () => {
      const coordinates = [
        { id: 0, x: 150, y: 200 },
        { id: 1, x: 300, y: 150 }
      ];

      const result = await manager.updateHotspotWalkToCoordinates(room2Path, coordinates);
      
      assert.ok(!result.isError, `Should not error: ${result.message}`);
      assert.ok(result.content.includes('Would update walk-to coordinates for 2'), 'Should indicate coordinate updates');
      assert.ok(result.content.includes('(150, 200)'), 'Should include first coordinates');
      assert.ok(result.content.includes('(300, 150)'), 'Should include second coordinates');
    });

    test('should validate coordinate ranges', async () => {
      const coordinates = [{ id: 0, x: -1, y: 10000 }];

      const result = await manager.updateHotspotWalkToCoordinates(room2Path, coordinates);
      
      assert.ok(result.isError, 'Should error with invalid coordinates');
      assert.ok(result.content.includes('Invalid coordinates'), 'Should specify coordinate error');
    });

    test('should validate hotspot IDs', async () => {
      const coordinates = [{ id: 50, x: 100, y: 100 }];

      const result = await manager.updateHotspotWalkToCoordinates(room2Path, coordinates);
      
      assert.ok(result.isError, 'Should error with invalid hotspot ID');
      assert.ok(result.content.includes('Invalid hotspot ID: 50'), 'Should specify invalid ID');
    });
  });

  describe('Enhanced Interaction Management', () => {
    test('should add hotspot interaction with validation', async () => {
      const result = await manager.addHotspotInteraction(room2Path, 1, 'Use', 'staffDoor_Use');
      
      assert.ok(!result.isError, `Should not error: ${result.message}`);
      assert.ok(result.content.includes('Added interaction metadata'), 'Should indicate interaction metadata addition');
      // Note: hotspot name may have changed due to previous modifications in the test file
      assert.ok(result.content.includes('Use'), 'Should include event type');
      assert.ok(result.content.includes('staffDoor_Use'), 'Should include function name');
      assert.ok(result.content.includes('script compilation not yet implemented'), 'Should acknowledge limitation');
    });

    test('should validate event types', async () => {
      const result = await manager.addHotspotInteraction(room2Path, 1, 'InvalidEvent', 'test_function');
      
      assert.ok(result.isError, 'Should error with invalid event');
      assert.ok(result.content.includes('Invalid event type'), 'Should specify event error');
      assert.ok(result.content.includes('supported: Look, Interact'), 'Should list valid events');
    });

    test('should validate function names', async () => {
      const result = await manager.addHotspotInteraction(room2Path, 1, 'Look', '123InvalidFunction');
      
      assert.ok(result.isError, 'Should error with invalid function name');
      assert.ok(result.content.includes('must be valid identifier'), 'Should specify identifier requirement');
    });

    test('should remove hotspot interactions', async () => {
      const result = await manager.removeHotspotInteraction(room2Path, 1, 'Look');
      
      assert.ok(!result.isError, `Should not error: ${result.message}`);
      assert.ok(result.content.includes('Would remove Look interaction'), 'Should indicate removal');
      // Note: hotspot name may have changed due to previous modifications in the test file
    });

    test('should list hotspot interactions', async () => {
      const result = await manager.listHotspotInteractions(room2Path, 1);
      
      assert.ok(!result.isError, `Should not error: ${result.message}`);
      assert.ok(typeof result.content === 'object', 'Should return object');
      assert.equal(result.content.hotspotId, 1, 'Should have correct hotspot ID');
      // Note: hotspot name may have changed due to previous modifications in the test file
      assert.ok(Array.isArray(result.content.availableInteractions), 'Should have interactions array');
      assert.ok(Array.isArray(result.content.supportedEvents), 'Should have supported events array');
    });

    test('should validate hotspot existence for interaction listing', async () => {
      const result = await manager.listHotspotInteractions(room2Path, 99);
      
      assert.ok(result.isError, 'Should error with invalid hotspot ID');
      assert.ok(result.content === null, 'Should return null content');
    });
  });

  describe('Batch Operations', () => {
    test('should perform batch hotspot modifications', async () => {
      const operations = [
        {
          type: 'updateWalkTo' as const,
          hotspotId: 0,
          data: { x: 150, y: 200 }
        },
        {
          type: 'addInteraction' as const,
          hotspotId: 1,
          data: { event: 'Use', functionName: 'lock_Use' }
        }
      ];

      const result = await manager.batchModifyHotspots(room2Path, operations);
      
      assert.ok(!result.isError, `Should not error: ${result.message}`);
      assert.ok(result.content.includes('Would perform 2 batch operation'), 'Should indicate batch operations');
      assert.ok(result.content.includes('set walk-to (150, 200)'), 'Should include walk-to operation');
      assert.ok(result.content.includes('add Use -> lock_Use()'), 'Should include interaction operation');
    });

    test('should validate batch operation types', async () => {
      const operations = [
        {
          type: 'invalidOperation' as any,
          hotspotId: 0,
          data: {}
        }
      ];

      const result = await manager.batchModifyHotspots(room2Path, operations);
      
      assert.ok(result.isError, 'Should error with invalid operation type');
      assert.ok(result.content.includes('Invalid operation type'), 'Should specify operation error');
    });

    test('should validate hotspot IDs in batch operations', async () => {
      const operations = [
        {
          type: 'modify' as const,
          hotspotId: 100,
          data: { name: 'Test' }
        }
      ];

      const result = await manager.batchModifyHotspots(room2Path, operations);
      
      assert.ok(result.isError, 'Should error with invalid hotspot ID');
      assert.ok(result.content.includes('Invalid hotspot ID: 100'), 'Should specify invalid ID');
    });
  });

  describe('MCP Protocol Integration for Phase 2 Tools', () => {
    test('should expose modify_hotspot_properties via MCP', async () => {
      const modifications = [{ id: 1, name: 'Test Door' }];
      const result = await testMCPTool('modify_hotspot_properties', {
        roomFile: room2Path,
        modifications
      });
      
      assert.ok(result.success, `MCP call should succeed: ${result.error}`);
      assert.ok(result.response.result, 'Should have result field');
    });

    test('should expose update_hotspot_walkto_coordinates via MCP', async () => {
      const coordinates = [{ id: 1, x: 100, y: 100 }];
      const result = await testMCPTool('update_hotspot_walkto_coordinates', {
        roomFile: room2Path,
        coordinates
      });
      
      assert.ok(result.success, `MCP call should succeed: ${result.error}`);
      assert.ok(result.response.result, 'Should have result field');
    });

    test('should expose list_hotspot_interactions via MCP', async () => {
      const result = await testMCPTool('list_hotspot_interactions', {
        roomFile: room2Path,
        hotspotId: 1
      });
      
      assert.ok(result.success, `MCP call should succeed: ${result.error}`);
      assert.ok(result.response.result, 'Should have result field');
      
      const content = JSON.parse(result.response.result.content[0].text);
      assert.equal(content.hotspotId, 1, 'Should return correct hotspot data');
    });

    test('should expose remove_hotspot_interaction via MCP', async () => {
      const result = await testMCPTool('remove_hotspot_interaction', {
        roomFile: room2Path,
        hotspotId: 0,
        event: 'Look'
      });
      
      assert.ok(result.success, `MCP call should succeed: ${result.error}`);
      assert.ok(result.response.result, 'Should have result field');
    });

    test('should expose batch_modify_hotspots via MCP', async () => {
      const operations = [
        {
          type: 'modify',
          hotspotId: 0,
          data: { name: 'Modified Door' }
        }
      ];
      
      const result = await testMCPTool('batch_modify_hotspots', {
        roomFile: room2Path,
        operations
      });
      
      assert.ok(result.success, `MCP call should succeed: ${result.error}`);
      assert.ok(result.response.result, 'Should have result field');
    });
  });

  describe('Validation Edge Cases', () => {
    test('should handle empty modification arrays', async () => {
      const result = await manager.modifyHotspotProperties(room2Path, []);
      
      assert.ok(!result.isError, 'Should not error with empty array');
      assert.ok(result.content.includes('Successfully modified 0 hotspot'), 'Should handle empty array');
    });

    test('should handle maximum string lengths', async () => {
      const longName = 'a'.repeat(60); // Exceeds 50 char limit
      const modifications = [{ id: 1, name: longName }];

      const result = await manager.modifyHotspotProperties(room2Path, modifications);
      
      assert.ok(result.isError, 'Should error with too long name');
      assert.ok(result.content.includes('length must be 1-50'), 'Should specify length requirement');
    });

    test('should handle coordinate edge values', async () => {
      const coordinates = [
        { id: 0, x: 0, y: 0 },      // Minimum values
        { id: 1, x: 9999, y: 9999 } // Maximum values
      ];

      const result = await manager.updateHotspotWalkToCoordinates(room2Path, coordinates);
      
      assert.ok(!result.isError, 'Should accept valid edge coordinates');
    });

    test('should handle missing room file gracefully', async () => {
      const nonexistentFile = path.join(tempDir, 'nonexistent.crm');
      const result = await manager.modifyHotspotProperties(nonexistentFile, [{ id: 0, name: 'Test' }]);
      
      assert.ok(result.isError, 'Should error with missing file');
      assert.ok(result.message, 'Should have error message');
    });
  });
});

// Helper function for testing MCP protocol
async function testMCPTool(toolName: string, args: any): Promise<{ 
  success: boolean; 
  response: any; 
  error?: string 
}> {
  return new Promise((resolve) => {
    const serverPath = path.join(__dirname, '../index.js');
    const proc = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    
    let response = '';
    let errorOutput = '';

    proc.stdout.on('data', (data) => response += data.toString());
    proc.stderr.on('data', (data) => errorOutput += data.toString());

    const request = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args },
      id: 1
    }) + '\n';

    proc.stdin.write(request);
    proc.stdin.end();

    setTimeout(() => {
      proc.kill();

      try {
        const jsonResponse = JSON.parse(response);
        resolve({ success: true, response: jsonResponse });
      } catch (parseError) {
        resolve({ 
          success: false, 
          response: {}, 
          error: `Parse error: ${parseError}. Response: ${response}. Stderr: ${errorOutput}` 
        });
      }
    }, 5000);
  });
}