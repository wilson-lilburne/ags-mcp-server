#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { AGSCrmManager } from './ags-crm-manager.js';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// Get package version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const packageVersion = packageJson.version;

/**
 * AGS MCP Server for .crm file manipulation
 * Provides tools for reading, writing, and modifying AGS compiled room files
 */
class AGSMcpServer {
  private server: Server;
  private crmManager: AGSCrmManager;

  constructor() {
    this.server = new Server(
      {
        name: 'ags-mcp-server',
        version: packageVersion,
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.crmManager = new AGSCrmManager();
    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'read_room_data',
            description: 'Parse a .crm file and return structured room data',
            inputSchema: {
              type: 'object',
              properties: {
                roomFile: {
                  type: 'string',
                  description: 'Path to the .crm file to read',
                },
              },
              required: ['roomFile'],
            },
          },
          {
            name: 'list_room_blocks',
            description: 'List all blocks in a .crm file',
            inputSchema: {
              type: 'object',
              properties: {
                roomFile: {
                  type: 'string',
                  description: 'Path to the .crm file to analyze',
                },
              },
              required: ['roomFile'],
            },
          },
          {
            name: 'export_room_block',
            description: 'Export a specific block from a .crm file',
            inputSchema: {
              type: 'object',
              properties: {
                roomFile: {
                  type: 'string',
                  description: 'Path to the .crm file',
                },
                blockId: {
                  type: ['string', 'number'],
                  description: 'Block ID to export (e.g., "5" for ObjNames)',
                },
                outputFile: {
                  type: 'string',
                  description: 'Output file path',
                },
                unpack: {
                  type: 'boolean',
                  description: 'Unpack/decode encoded block data',
                  default: false,
                },
              },
              required: ['roomFile', 'blockId', 'outputFile'],
            },
          },
          {
            name: 'import_room_block',
            description: 'Import/replace a block in a .crm file',
            inputSchema: {
              type: 'object',
              properties: {
                roomFile: {
                  type: 'string',
                  description: 'Path to the .crm file to modify',
                },
                blockId: {
                  type: ['string', 'number'],
                  description: 'Block ID to import (e.g., "5" for ObjNames)',
                },
                inputFile: {
                  type: 'string',
                  description: 'Input file path containing block data',
                },
                outputFile: {
                  type: 'string',
                  description: 'Output .crm file path (optional - modifies original if not specified)',
                },
              },
              required: ['roomFile', 'blockId', 'inputFile'],
            },
          },
          {
            name: 'get_room_hotspots',
            description: 'Extract hotspot information from a room',
            inputSchema: {
              type: 'object',
              properties: {
                roomFile: {
                  type: 'string',
                  description: 'Path to the .crm file',
                },
              },
              required: ['roomFile'],
            },
          },
          {
            name: 'add_hotspot_interaction',
            description: 'Add an interaction event handler to a hotspot',
            inputSchema: {
              type: 'object',
              properties: {
                roomFile: {
                  type: 'string',
                  description: 'Path to the .crm file',
                },
                hotspotId: {
                  type: 'number',
                  description: 'Hotspot ID (0-based index)',
                },
                event: {
                  type: 'string',
                  description: 'Event type (Look, Interact, UseInv, etc.)',
                },
                functionName: {
                  type: 'string',
                  description: 'Script function name (e.g., "hotspot1_Look")',
                },
                outputFile: {
                  type: 'string',
                  description: 'Output .crm file path (optional)',
                },
              },
              required: ['roomFile', 'hotspotId', 'event', 'functionName'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!args) {
        throw new McpError(ErrorCode.InvalidParams, 'Missing arguments');
      }

      try {
        let result: any;
        
        switch (name) {
          case 'read_room_data':
            result = await this.crmManager.readRoomData(args.roomFile as string);
            break;

          case 'list_room_blocks':
            result = await this.crmManager.listRoomBlocks(args.roomFile as string);
            break;

          case 'export_room_block':
            result = await this.crmManager.exportRoomBlock(
              args.roomFile as string,
              args.blockId as string | number,
              args.outputFile as string,
              args.unpack as boolean,
            );
            break;

          case 'import_room_block':
            result = await this.crmManager.importRoomBlock(
              args.roomFile as string,
              args.blockId as string | number,
              args.inputFile as string,
              args.outputFile as string,
            );
            break;

          case 'get_room_hotspots':
            result = await this.crmManager.getRoomHotspots(args.roomFile as string);
            break;

          case 'add_hotspot_interaction':
            result = await this.crmManager.addHotspotInteraction(
              args.roomFile as string,
              args.hotspotId as number,
              args.event as string,
              args.functionName as string,
              args.outputFile as string,
            );
            break;

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`,
            );
        }

        // Convert the result to proper MCP format
        if (!result || typeof result !== 'object') {
          return {
            content: [
              {
                type: 'text',
                text: `Unexpected result format: ${String(result)}`,
              }
            ],
            isError: true,
          };
        }

        if (result.isError) {
          return {
            content: [
              {
                type: 'text',
                text: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
              }
            ],
            isError: true,
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2),
              }
            ],
          };
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    // Server is now ready - no logging to avoid contaminating MCP JSON stream
  }
}

// Parse command line arguments
const program = new Command();

program
  .name('ags-mcp-server')
  .description('MCP Server for AGS .crm file manipulation')
  .version(packageVersion);

program
  .command('demo', { isDefault: false })
  .description('Run the demo to show MCP tools functionality')
  .action(async () => {
    try {
      // Import and run the demo script
      await import('./demo.js');
    } catch (error) {
      console.error('Failed to run demo:', error);
      process.exit(1);
    }
  });

program
  .action(() => {
    // Default action is to start the MCP server
    const server = new AGSMcpServer();
    server.run().catch((error) => {
      console.error('Server failed to start:', error);
      process.exit(1);
    });
  });

program.parse();
