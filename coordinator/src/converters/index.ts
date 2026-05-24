import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { string2int } from "./string2int.js";
import { json2id } from "./json2id.js";

/**
 * Converters — a class of tools that turn one data type into another so values
 * can be chained into comparators/arithmetic. New conversions ("if explained
 * how") drop in here behind the same server.
 */

export const CONVERTERS_SERVER = "converters";

export const string2intTool = tool(
  "string2int",
  'Convert a string to an integer: a digit string ("12") or an English number phrase ("twelve", "three hundred forty two"). Use it to normalise a word-number before feeding it to a numeric tool.',
  { value: z.string().describe('the string to convert, e.g. "twelve"') },
  async (args) => {
    try {
      return { content: [{ type: "text", text: String(string2int(args.value)) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  },
);

export const json2idTool = tool(
  "json2id",
  'Extract an identifying field from a JSON object and return it as a string (default field "id"). Use it to reduce an object to a comparable scalar.',
  {
    json: z.string().describe("the JSON object, as a string"),
    field: z.string().optional().describe('the identifying field to extract (default "id")'),
  },
  async (args) => {
    try {
      return { content: [{ type: "text", text: json2id(args.json, args.field ?? "id") }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  },
);

export const STRING2INT_TOOL = `mcp__${CONVERTERS_SERVER}__string2int`;
export const JSON2ID_TOOL = `mcp__${CONVERTERS_SERVER}__json2id`;
export const CONVERTER_TOOLS = [STRING2INT_TOOL, JSON2ID_TOOL];

export function convertersServer() {
  return createSdkMcpServer({
    name: CONVERTERS_SERVER,
    version: "0.1.0",
    tools: [string2intTool, json2idTool],
  });
}
