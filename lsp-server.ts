import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type TextDocumentChangeEvent,
  Range,
  Position,
  TextEdit,
  type Diagnostic,
  DiagnosticSeverity,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { ServerWebSocket } from "bun";

let currentValue = 0;
const WEB_PORT = 3001;

const webClients = new Set<ServerWebSocket<unknown>>();
const lspConnection = createConnection(ProposedFeatures.all);
const files = new TextDocuments(TextDocument);

function broadcastValueToWebClient(client: ServerWebSocket<unknown>) {
  client.send(JSON.stringify({ value: currentValue }));
}

function setValueInDocuments() {
  files.all().forEach((file) => {
    lspConnection.workspace.applyEdit({
      changes: {
        [file.uri]: [
          TextEdit.replace(
            Range.create(
              Position.create(0, 0),
              Position.create(file.lineCount, 0),
            ),
            currentValue.toString(),
          ),
        ],
      },
    });
  });
}

lspConnection.onInitialize(() => ({
  capabilities: { textDocumentSync: TextDocumentSyncKind.Full },
}));

files.onDidChangeContent((e: TextDocumentChangeEvent<TextDocument>) => {
  const documentContent = e.document.getText().trim();
  const value = Number(documentContent);
  const isValid = !isNaN(value) && documentContent !== "";

  let diagnostics: Diagnostic[] = [];
  if (!isValid) {
    const lines = e.document.getText().split("\n");
    const lastLineIndex = lines.length - 1;
    const lastLine = lines[lastLineIndex]!;
    diagnostics = [
      {
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: 0, character: 0 },
          end: { line: lastLineIndex, character: lastLine.length },
        },
        message: "Document must contain a single numeric value.",
        source: "bdne",
      },
    ];
  }
  lspConnection.sendDiagnostics({
    uri: e.document.uri,
    diagnostics,
  });

  if (!isValid) return;

  currentValue = value;
  webClients.forEach(broadcastValueToWebClient);
});

files.listen(lspConnection);
lspConnection.listen();

Bun.serve({
  port: WEB_PORT,
  async fetch(req, server) {
    const path = new URL(req.url).pathname;
    switch (path) {
      case "/":
        return new Response(Bun.file("index.html"));

      case "/socket":
        server.upgrade(req);
        return;

      default:
        return new Response("Not found", { status: 404 });
    }
  },
  websocket: {
    open(ws) {
      webClients.add(ws);
      broadcastValueToWebClient(ws);
    },
    message(_ws, msg: string) {
      currentValue = JSON.parse(msg).value;
      setValueInDocuments();
    },
    close(ws) {
      webClients.delete(ws);
    },
  },
});

// Open the web client in the browser on startup
Bun.spawn(["open", `http://localhost:${WEB_PORT}/`]);
