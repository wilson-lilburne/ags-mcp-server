import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process'; // Still needed for MCP server testing
import { promises as fs, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGSCrmManager } from '../ags-crm-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 1: Infrastructure Tests', () => {
  let testDataDir: string;
  let tempDir: string;

  before(async () => {
    // Setup test environment within repo
    testDataDir = path.join(__dirname, '../../test-data');
    tempDir = path.join(__dirname, '../../temp-test');

    // Create test directories
    await fs.mkdir(testDataDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });
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

  describe('Direct Binary Processing', () => {
    test('should initialize AGS manager without external dependencies', () => {
      const manager = new AGSCrmManager({ silent: true });
      assert.ok(manager, 'AGS manager should initialize successfully');
    });

    test('should handle file operations without external tools', async () => {
      const manager = new AGSCrmManager({ silent: true });
      const room2Path = path.join(__dirname, '../../room2.crm');
      
      if (!existsSync(room2Path)) {
        console.log('      Skipping test - room2.crm not available');
        return;
      }
      
      // Test that we can parse blocks without external dependencies
      const result = await manager.listRoomBlocks(room2Path);
      assert.ok(!result.isError || result.message?.includes('Direct parsing'), 
        'Should attempt direct parsing');
    });

    test('should be platform independent', () => {
      // Test that initialization works on any platform
      const manager = new AGSCrmManager({ silent: true });
      assert.ok(manager, 'Manager should work on any platform');
      
      // Log platform info for verification
      console.log(`      Platform: ${process.platform}, Arch: ${process.arch}`);
    });
  });

  describe('Test Data Validation', () => {
    test('should have room2.crm test file in repo', () => {
      const room2Path = path.join(__dirname, '../../room2.crm');
      assert.ok(existsSync(room2Path), `room2.crm not found at ${room2Path}`);
      
      const stats = statSync(room2Path);
      assert.ok(stats.size > 100, 'room2.crm file is too small to be valid');
    });

    test('should be able to read room2.crm binary data', async () => {
      const room2Path = path.join(__dirname, '../../room2.crm');
      const data = await fs.readFile(room2Path);
      
      assert.ok(data.length > 100, 'room2.crm data is too small');
      // Basic validation - AGS room files should have some structure
      assert.ok(data[0] !== 0 || data[1] !== 0, 'room2.crm appears to start with null bytes');
    });

    test('should copy test files to test directory', async () => {
      const sourceRoom = path.join(__dirname, '../../room2.crm');
      const testRoom = path.join(testDataDir, 'room2.crm');
      
      await fs.copyFile(sourceRoom, testRoom);
      assert.ok(existsSync(testRoom), 'Failed to copy room2.crm to test directory');
      
      // Verify files are identical
      const originalData = await fs.readFile(sourceRoom);
      const copiedData = await fs.readFile(testRoom);
      assert.deepEqual(originalData, copiedData, 'Copied file differs from original');
    });
  });

  describe('MCP Server Build', () => {
    test('should have built MCP server', () => {
      const serverPath = path.join(__dirname, '../index.js');
      assert.ok(existsSync(serverPath), 'MCP server not built - run npm run build');
    });

    test('should respond to MCP protocol requests', async () => {
      const result = await testMCPProtocol();
      assert.ok(result.success, `MCP protocol test failed: ${result.error}`);
      assert.ok(result.toolCount > 0, 'No MCP tools found in response');
    });

    test('should list expected MCP tools', async () => {
      const result = await testMCPProtocol();
      assert.ok(result.success, `MCP protocol test failed: ${result.error}`);
      
      const expectedTools = [
        'read_room_data',
        'list_room_blocks', 
        'export_room_block',
        'import_room_block',
        'get_room_hotspots',
        'add_hotspot_interaction'
      ];
      
      for (const tool of expectedTools) {
        assert.ok(
          result.tools.includes(tool),
          `Missing expected MCP tool: ${tool}. Found: ${result.tools.join(', ')}`
        );
      }
    });
  });

  describe('AGS CRM Manager', () => {
    test('should initialize without errors', () => {
      assert.doesNotThrow(() => {
        new AGSCrmManager({ silent: true });
      }, 'AGSCrmManager constructor should not throw');
    });

    test('should initialize in silent mode without console output', () => {
      // Capture console output
      const originalWarn = console.warn;
      const originalLog = console.log;
      let consoleOutput = '';
      
      console.warn = (msg) => { consoleOutput += msg; };
      console.log = (msg) => { consoleOutput += msg; };
      
      try {
        new AGSCrmManager({ silent: true });
        // Should not produce console output in silent mode
        assert.equal(consoleOutput, '', 'Silent mode should not produce console output');
      } finally {
        console.warn = originalWarn;
        console.log = originalLog;
      }
    });

    test('should handle operations gracefully when binary unavailable', async () => {
      const manager = new AGSCrmManager({ silent: true });
      const testRoom = path.join(testDataDir, 'room2.crm');
      
      // Operations should return error results, not throw exceptions
      const result = await manager.listRoomBlocks(testRoom);
      assert.ok(typeof result === 'object', 'Should return result object');
      assert.ok('content' in result, 'Should have content property');
      
      // May succeed or fail depending on binary availability, but shouldn't crash
      if (result.isError) {
        assert.ok(typeof result.message === 'string', 'Error should have message');
      }
    });
  });

  describe('File Access Permissions', () => {
    test('should be able to create temporary files', async () => {
      const tempFile = path.join(tempDir, 'test-file.tmp');
      await fs.writeFile(tempFile, 'test content');
      
      assert.ok(existsSync(tempFile), 'Could not create temporary file');
      
      const content = await fs.readFile(tempFile, 'utf-8');
      assert.equal(content, 'test content', 'File content mismatch');
    });

    test('should be able to read and write in test directories', async () => {
      // Test read access
      const files = await fs.readdir(testDataDir);
      assert.ok(Array.isArray(files), 'Could not read test data directory');
      
      // Test write access
      const testFile = path.join(tempDir, 'write-test.txt');
      await fs.writeFile(testFile, 'write test');
      
      const writtenContent = await fs.readFile(testFile, 'utf-8');
      assert.equal(writtenContent, 'write test', 'Write test failed');
    });
  });
});

// Helper functions
async function testMCPProtocol(): Promise<{ 
  success: boolean; 
  error?: string; 
  toolCount: number; 
  tools: string[] 
}> {
  return new Promise((resolve) => {
    const serverPath = path.join(__dirname, '../index.js');
    
    if (!existsSync(serverPath)) {
      resolve({ success: false, error: 'Server not found', toolCount: 0, tools: [] });
      return;
    }

    const proc = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let response = '';
    let stderr = '';

    proc.stdout.on('data', (data) => response += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());

    const request = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/list', 
      id: 1
    }) + '\n';

    proc.stdin.write(request);
    proc.stdin.end();

    setTimeout(() => {
      proc.kill();

      try {
        const jsonResponse = JSON.parse(response);
        if (jsonResponse.result?.tools && Array.isArray(jsonResponse.result.tools)) {
          const tools = jsonResponse.result.tools.map((t: any) => t.name);
          resolve({ success: true, toolCount: tools.length, tools });
        } else {
          resolve({ 
            success: false, 
            error: `Invalid response format. Response: ${response}. Stderr: ${stderr}`, 
            toolCount: 0, 
            tools: [] 
          });
        }
      } catch (parseError) {
        resolve({ 
          success: false, 
          error: `JSON parse error: ${parseError}. Response: ${response}. Stderr: ${stderr}`, 
          toolCount: 0, 
          tools: [] 
        });
      }
    }, 3000);
  });
}