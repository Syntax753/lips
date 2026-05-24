// Command comparators is a minimal Model Context Protocol (MCP) server that
// exposes one boolean comparator per tool (gt, lt, gte, lte, eq, neq). It
// speaks JSON-RPC 2.0 over stdio using only the standard library: each line on
// stdin is one request, each line on stdout is one response.
//
// The server implements just the slice of MCP that a client needs to discover
// and call tools: initialize, notifications/initialized, ping, tools/list and
// tools/call. Prompts and resources can be layered on later.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// defaultProtocolVersion is used when a client does not announce one. We echo
// the client's requested version back when present for maximum compatibility.
const defaultProtocolVersion = "2025-06-18"

const (
	serverName    = "comparators"
	serverVersion = "0.1.0"
)

// --- JSON-RPC 2.0 wire types -------------------------------------------------

// rpcRequest covers both requests (with an id) and notifications (without).
type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// A response is either a success (result present) or an error. We use two
// distinct types so that the JSON always carries exactly one of the fields,
// rather than relying on omitempty (which would drop a legitimately empty
// result object such as {}).
type rpcSuccess struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  interface{}     `json:"result"`
}

type rpcErrorResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Error   rpcError        `json:"error"`
}

type rpcError struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// --- MCP payload types -------------------------------------------------------

type initializeParams struct {
	ProtocolVersion string `json:"protocolVersion"`
}

type initializeResult struct {
	ProtocolVersion string             `json:"protocolVersion"`
	Capabilities    serverCapabilities `json:"capabilities"`
	ServerInfo      implementation     `json:"serverInfo"`
}

type serverCapabilities struct {
	Tools *toolsCapability `json:"tools,omitempty"`
}

type toolsCapability struct {
	ListChanged bool `json:"listChanged"`
}

type implementation struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type toolDescriptor struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	InputSchema interface{} `json:"inputSchema"`
}

type listToolsResult struct {
	Tools []toolDescriptor `json:"tools"`
}

type callToolParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type textContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type callToolResult struct {
	Content           []textContent `json:"content"`
	StructuredContent interface{}   `json:"structuredContent,omitempty"`
	IsError           bool          `json:"isError"`
}

// rawOperands is used to detect missing fields: a nil pointer means the caller
// omitted the operand entirely, which is a different (and reportable) thing
// from passing zero.
type rawOperands struct {
	LHS *float64 `json:"lhs"`
	RHS *float64 `json:"rhs"`
}

func main() {
	dec := json.NewDecoder(bufio.NewReader(os.Stdin))
	out := bufio.NewWriter(os.Stdout)

	for {
		var req rpcRequest
		if err := dec.Decode(&req); err != nil {
			if err == io.EOF {
				return // client closed the stream; shut down cleanly.
			}
			// A malformed message leaves the decoder in an unknown state, so
			// there is no safe way to continue. Report and exit.
			fmt.Fprintf(os.Stderr, "comparators: decode error: %v\n", err)
			return
		}
		handle(&req, out)
	}
}

func handle(req *rpcRequest, out *bufio.Writer) {
	isNotification := len(req.ID) == 0

	switch req.Method {
	case "initialize":
		var p initializeParams
		_ = json.Unmarshal(req.Params, &p)
		version := p.ProtocolVersion
		if version == "" {
			version = defaultProtocolVersion
		}
		writeResult(out, req.ID, initializeResult{
			ProtocolVersion: version,
			Capabilities:    serverCapabilities{Tools: &toolsCapability{ListChanged: false}},
			ServerInfo:      implementation{Name: serverName, Version: serverVersion},
		})

	case "notifications/initialized":
		// Fire-and-forget notification; nothing to reply.

	case "ping":
		writeResult(out, req.ID, struct{}{})

	case "tools/list":
		writeResult(out, req.ID, listToolsResult{Tools: toolDescriptors()})

	case "tools/call":
		handleToolCall(req, out)

	default:
		if !isNotification {
			writeError(out, req.ID, -32601, "method not found: "+req.Method)
		}
	}
}

func handleToolCall(req *rpcRequest, out *bufio.Writer) {
	var params callToolParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		writeError(out, req.ID, -32602, "invalid params: "+err.Error())
		return
	}

	var raw rawOperands
	if err := json.Unmarshal(params.Arguments, &raw); err != nil {
		writeToolError(out, req.ID, "invalid arguments: "+err.Error())
		return
	}
	if raw.LHS == nil || raw.RHS == nil {
		writeToolError(out, req.ID, "both 'lhs' and 'rhs' are required")
		return
	}

	result, err := Evaluate(params.Name, *raw.LHS, *raw.RHS)
	if err != nil {
		writeToolError(out, req.ID, err.Error())
		return
	}

	text := "false"
	if result {
		text = "true"
	}
	writeResult(out, req.ID, callToolResult{
		Content:           []textContent{{Type: "text", Text: text}},
		StructuredContent: map[string]bool{"result": result},
		IsError:           false,
	})
}

// toolDescriptors builds the tools/list payload from the comparator catalog.
// Every comparator shares the same {lhs, rhs} numeric input schema.
func toolDescriptors() []toolDescriptor {
	schema := map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"lhs": map[string]interface{}{"type": "number", "description": "left-hand-side operand"},
			"rhs": map[string]interface{}{"type": "number", "description": "right-hand-side operand"},
		},
		"required":             []string{"lhs", "rhs"},
		"additionalProperties": false,
	}

	tools := make([]toolDescriptor, 0, len(ComparatorCatalog))
	for _, m := range ComparatorCatalog {
		tools = append(tools, toolDescriptor{
			Name:        m.Name,
			Description: m.Description,
			InputSchema: schema,
		})
	}
	return tools
}

// --- response writers --------------------------------------------------------

func writeResult(out *bufio.Writer, id json.RawMessage, result interface{}) {
	writeMessage(out, rpcSuccess{JSONRPC: "2.0", ID: id, Result: result})
}

func writeError(out *bufio.Writer, id json.RawMessage, code int, message string) {
	writeMessage(out, rpcErrorResponse{JSONRPC: "2.0", ID: id, Error: rpcError{Code: code, Message: message}})
}

// writeToolError reports a tool-execution failure as a normal result with
// isError set, per the MCP convention (distinct from a JSON-RPC protocol error).
func writeToolError(out *bufio.Writer, id json.RawMessage, message string) {
	writeResult(out, id, callToolResult{
		Content: []textContent{{Type: "text", Text: message}},
		IsError: true,
	})
}

func writeMessage(out *bufio.Writer, v interface{}) {
	b, err := json.Marshal(v)
	if err != nil {
		fmt.Fprintf(os.Stderr, "comparators: marshal error: %v\n", err)
		return
	}
	out.Write(b)
	out.WriteByte('\n')
	out.Flush()
}
