#!/usr/bin/env node

// Simulate what Claude Desktop would receive from the MCP server
import { spawn } from 'child_process';

async function testMCPServerResponse() {
  console.log('🔍 Testing MCP Server as Claude Desktop would see it...\n');
  
  // Test the MCP server by calling it directly
  const testCases = [
    {
      name: 'list_tools',
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      }
    },
    {
      name: 'call list_room_blocks',
      request: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'list_room_blocks',
          arguments: {
            roomFile: 'test.crm'
          }
        }
      }
    },
    {
      name: 'call get_room_hotspots',
      request: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_room_hotspots',
          arguments: {
            roomFile: 'test.crm'
          }
        }
      }
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`📨 Testing: ${testCase.name}`);
    
    try {
      const response = await callMCPServer(testCase.request);
      console.log('✅ Response received:');
      console.log(JSON.stringify(response, null, 2));
      
      // Validate response structure
      if (testCase.name.startsWith('call ')) {
        if (response.result && response.result.content && Array.isArray(response.result.content)) {
          console.log('✅ Content is array - no "map is not a function" error');
          
          response.result.content.forEach((item, i) => {
            if (item.type && item.text) {
              console.log(`✅ Item ${i} has proper structure (type: ${item.type})`);
            } else {
              console.log(`❌ Item ${i} missing type or text:`, item);
            }
          });
        } else {
          console.log('❌ Invalid response structure:', response);
        }
      }
      
    } catch (error) {
      console.log('❌ Error:', error.message);
    }
    
    console.log('');
  }
}

function callMCPServer(request) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      console.log(`[DEBUG] MCP Server stderr output:`);
      console.log(stderr);
      
      // Parse JSON response from stdout
      try {
        const lines = stdout.trim().split('\n').filter(line => line.trim());
        const lastLine = lines[lines.length - 1];
        if (lastLine) {
          const response = JSON.parse(lastLine);
          resolve(response);
        } else {
          reject(new Error('No response from MCP server'));
        }
      } catch (error) {
        reject(new Error(`Failed to parse response: ${error.message}\nStdout: ${stdout}`));
      }
    });
    
    proc.on('error', (error) => {
      reject(new Error(`Failed to start MCP server: ${error.message}`));
    });
    
    // Send the request
    proc.stdin.write(JSON.stringify(request) + '\n');
    proc.stdin.end();
  });
}

testMCPServerResponse().catch(console.error);