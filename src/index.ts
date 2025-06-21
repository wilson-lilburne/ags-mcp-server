#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { AGSCrmManagerV2 } from './ags-crm-manager-v2.js';
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
  private crmManager: AGSCrmManagerV2;

  constructor(options: { silent?: boolean } = {}) {
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

    // When running in JSON-RPC mode, we want to suppress diagnostic messages
    this.crmManager = new AGSCrmManagerV2({ silent: options.silent });
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
          {
            name: 'modify_hotspot_properties',
            description: 'Modify hotspot properties (name, script name, walk-to coordinates, etc.)',
            inputSchema: {
              type: 'object',
              properties: {
                roomFile: {
                  type: 'string',
                  description: 'Path to the .crm file',
                },
                modifications: {
                  type: 'array',
                  description: 'Array of hotspot modifications',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'number', description: 'Hotspot ID (0-49)' },
                      name: { type: 'string', description: 'New hotspot name' },
                      scriptName: { type: 'string', description: 'New script name' },
                      walkTo: { 
                        type: 'object',
                        properties: {
                          x: { type: 'number' },
                          y: { type: 'number' }
                        },
                        description: 'Walk-to coordinates'
                      },
                      enabled: { type: 'boolean', description: 'Enable/disable hotspot' },
                      description: { type: 'string', description: 'Hotspot description' },
                      properties: { type: 'object', description: 'Custom properties' }
                    },
                    required: ['id']
                  }
                },
                outputFile: {
                  type: 'string',
                  description: 'Output .crm file path (optional)',
                },
              },
              required: ['roomFile', 'modifications'],
            },
          },
          {
            name: 'update_hotspot_walkto_coordinates',
            description: 'Update walk-to coordinates for multiple hotspots',
            inputSchema: {
              type: 'object',
              properties: {
                roomFile: {
                  type: 'string',
                  description: 'Path to the .crm file',
                },
                coordinates: {
                  type: 'array',
                  description: 'Array of hotspot coordinate updates',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'number', description: 'Hotspot ID (0-49)' },
                      x: { type: 'number', description: 'X coordinate' },
                      y: { type: 'number', description: 'Y coordinate' }
                    },
                    required: ['id', 'x', 'y']
                  }
                },
                outputFile: {
                  type: 'string',
                  description: 'Output .crm file path (optional)',
                },
              },
              required: ['roomFile', 'coordinates'],
            },
          },
          {
            name: 'batch_modify_hotspots',
            description: 'Batch modify multiple hotspots in a single operation',
            inputSchema: {
              type: 'object',
              properties: {
                roomFile: {
                  type: 'string',
                  description: 'Path to the .crm file',
                },
                operations: {
                  type: 'array',
                  description: 'Array of operations to perform',
                  items: {
                    type: 'object',
                    properties: {
                      type: { 
                        type: 'string',
                        enum: ['modify', 'addInteraction', 'updateWalkTo'],
                        description: 'Operation type'
                      },
                      hotspotId: { type: 'number', description: 'Hotspot ID (0-49)' },
                      data: { type: 'object', description: 'Operation-specific data' }
                    },
                    required: ['type', 'hotspotId', 'data']
                  }
                },
                outputFile: {
                  type: 'string',
                  description: 'Output .crm file path (optional)',
                },
              },
              required: ['roomFile', 'operations'],
            },
          },
          {
            name: 'remove_hotspot_interaction',
            description: 'Remove an interaction event handler from a hotspot',
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
                  description: 'Event type to remove (Look, Interact, UseInv, etc.)',
                },
                outputFile: {
                  type: 'string',
                  description: 'Output .crm file path (optional)',
                },
              },
              required: ['roomFile', 'hotspotId', 'event'],
            },
          },
          {
            name: 'list_hotspot_interactions',
            description: 'List all interactions for a specific hotspot',
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
              },
              required: ['roomFile', 'hotspotId'],
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

          case 'modify_hotspot_properties':
            result = await this.crmManager.modifyHotspotProperties(
              args.roomFile as string,
              args.modifications as any[],
              args.outputFile as string,
            );
            break;

          case 'update_hotspot_walkto_coordinates':
            result = await this.crmManager.updateHotspotWalkToCoordinates(
              args.roomFile as string,
              args.coordinates as any[],
              args.outputFile as string,
            );
            break;

          case 'batch_modify_hotspots':
            result = await this.crmManager.batchModifyHotspots(
              args.roomFile as string,
              args.operations as any[],
              args.outputFile as string,
            );
            break;

          case 'remove_hotspot_interaction':
            result = await this.crmManager.removeHotspotInteraction(
              args.roomFile as string,
              args.hotspotId as number,
              args.event as string,
              args.outputFile as string,
            );
            break;

          case 'list_hotspot_interactions':
            result = await this.crmManager.listHotspotInteractions(
              args.roomFile as string,
              args.hotspotId as number,
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
    // When no command is specified, we're likely running in JSON-RPC mode
    // so we want to suppress diagnostic messages
    const server = new AGSMcpServer({ silent: true });
    server.run().catch((error) => {
      console.error('Server failed to start:', error);
      process.exit(1);
    });
  });

program.parse();
