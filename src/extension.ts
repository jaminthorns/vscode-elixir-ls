import * as os from "os";
import * as path from "path";
import * as shell from "shelljs";
import * as vscode from "vscode";

import { execSync } from "child_process";
import {
  DebugAdapterDescriptor,
  DebugAdapterDescriptorFactory,
  DebugAdapterExecutable,
  DebugSession,
  ExtensionContext,
  Position,
  ProviderResult,
  Selection,
  TerminalLink,
  TerminalLinkContext,
  TextDocument,
  TextEditorRevealType,
  Uri,
  WorkspaceFolder,
} from "vscode";
import {
  DocumentFilter,
  DocumentSelector,
  LanguageClient,
  LanguageClientOptions,
  RevealOutputChannelOn,
  ServerOptions,
} from "vscode-languageclient";

import copyDebugInfo from "./commands/copyDebugInfo";
import runTestFromCodeLens from "./commands/runTestFromCodeLens";

const LANGUAGES = ["elixir", "eex", "html-eex"];
const FILE_EXTENSIONS = ["ex", "exs", "erl", "yrl", "xrl", "eex", "leex"];

export let defaultClient: LanguageClient | undefined;
export const workspaceClients: Map<Uri, LanguageClient> = new Map();

const commands = [copyDebugInfo, runTestFromCodeLens];

function testElixirCommand(command: string): false | Buffer {
  try {
    return execSync(`${command} -e " "`);
  } catch {
    return false;
  }
}

function testElixir(): boolean {
  let testResult = testElixirCommand("elixir");

  // Try finding elixir in the path directly.
  if (testResult === false) {
    const elixirPath = shell.which("elixir");

    if (elixirPath) {
      testResult = testElixirCommand(elixirPath);
    }
  }

  if (!testResult) {
    vscode.window.showErrorMessage(
      "Failed to run 'elixir' command. ElixirLS will probably fail to launch. Logged PATH to Development Console."
    );
    console.warn(
      `Failed to run 'elixir' command. Current process's PATH: ${process.env["PATH"]}`
    );

    return false;
  } else if (testResult.length > 0) {
    vscode.window.showErrorMessage(
      "Running 'elixir' command caused extraneous print to stdout. See VS Code's developer console for details."
    );
    console.warn(
      "Running 'elixir -e \"\"' printed to stdout:\n" + testResult.toString()
    );

    return false;
  } else {
    return true;
  }
}

function detectConflictingExtension(extensionId: string): void {
  if (vscode.extensions.getExtension(extensionId)) {
    vscode.window.showErrorMessage(
      `Warning: ${extensionId} is not compatible with ElixirLS, please uninstall ${extensionId}`
    );
  }
}

class DebugAdapterExecutableFactory implements DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(
    session: DebugSession,
    executable: DebugAdapterExecutable
  ): ProviderResult<DebugAdapterDescriptor> {
    const { options, command, args } = executable;

    if (session.workspaceFolder) {
      const cwd = session.workspaceFolder.uri.fsPath;
      const optionsWithCwd = options ? { ...options, cwd } : { cwd };

      return new DebugAdapterExecutable(command, args, optionsWithCwd);
    } else {
      return executable;
    }
  }
}

function configureDebugger(context: ExtensionContext): void {
  // Use a custom DebugAdapterExecutableFactory that launches the debugger with
  // the current working directory set to the workspace root so `asdf` can load
  // the correct environment properly.
  const factory = new DebugAdapterExecutableFactory();
  const disposable = vscode.debug.registerDebugAdapterDescriptorFactory(
    "mix_task",
    factory
  );

  context.subscriptions.push(disposable);
}

async function openDocumentAtLine(uri: Uri, line: number) {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const position = new Position(line - 1, 0);
  const selection = new Selection(position, position);

  editor.revealRange(selection, TextEditorRevealType.InCenter);
  editor.selection = selection;
}

// Configures application-aware terminal links.
function configureTerminalLinks(context: ExtensionContext): void {
  type ElixirTerminalLink = TerminalLink & {
    data: { app: string; file: string; line: number };
  };

  const provideTerminalLinks = (
    context: TerminalLinkContext
  ): ProviderResult<ElixirTerminalLink[]> => {
    const linePattern = /(?:\((?<app>[_a-z]+) \d+.\d+.\d+\) )(?<file>[_a-z/]*[_a-z]+.ex):(?<line>\d+)/;
    const matches = context.line.match(linePattern);

    if (matches === null) {
      return null;
    } else {
      const { app, file, line } = matches.groups!;
      const match = matches[0];
      const fileStartIndex = match.indexOf(file);
      const startIndex = matches.index! + fileStartIndex;
      const endIndex = matches.index! + match.length;

      const link = {
        startIndex,
        length: endIndex - startIndex,
        data: { app, file, line: parseInt(line) },
      };

      return [link];
    }
  };

  const handleTerminalLink = async ({ data }: ElixirTerminalLink) => {
    const { app, file, line } = data;
    const umbrellaFile = path.join("apps", app, file);
    const dependencyFile = path.join("deps", app, file);
    const filePattern = `{${file},${umbrellaFile},${dependencyFile}}`;
    const uris = await vscode.workspace.findFiles(filePattern);

    if (uris.length === 1) {
      await openDocumentAtLine(uris[0], line);
    }

    // If there are multiple results, let the user choose.
    if (uris.length > 1) {
      const items = uris.map((uri) => ({ label: uri.fsPath, uri }));
      const selection = await vscode.window.showQuickPick(items);

      if (selection) {
        await openDocumentAtLine(selection.uri, line);
      }
    }
  };

  const disposable = vscode.window.registerTerminalLinkProvider({
    provideTerminalLinks,
    handleTerminalLink,
  });

  context.subscriptions.push(disposable);
}

function configureCommands(context: ExtensionContext): void {
  commands.forEach(({ name, command }) => {
    const disposable = vscode.commands.registerCommand(name, command);
    context.subscriptions.push(disposable);
  });
}

function rootWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);

  if (folder) {
    const folders = Array.from(vscode.workspace.workspaceFolders || []);
    const parent = folders
      .sort((a, b) => a.uri.fsPath.length - b.uri.fsPath.length)
      .find((parent) => folder.uri.fsPath.startsWith(parent.uri.fsPath));

    return parent || folder;
  }
}

function startClient(
  context: ExtensionContext,
  documentSelector: DocumentSelector,
  workspaceFolder?: WorkspaceFolder
): LanguageClient {
  const filePathPattern = `**/*.{${FILE_EXTENSIONS.join(",")}}`;
  const commandFileExtension = os.platform() == "win32" ? "bat" : "sh";
  const commandFile = `language_server.${commandFileExtension}`;

  const serverOptions: ServerOptions = {
    command: context.asAbsolutePath("./elixir-ls-release/" + commandFile),
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector,
    workspaceFolder,
    synchronize: {
      configurationSection: "elixirLS",
      fileEvents: vscode.workspace.createFileSystemWatcher(filePathPattern),
    },
    // Request handler errors are unimportant.
    revealOutputChannelOn: RevealOutputChannelOn.Never,
  };

  const client = new LanguageClient(
    "elixirLS",
    "ElixirLS",
    serverOptions,
    clientOptions
  );

  const disposable = client.start();

  context.subscriptions.push(disposable);

  return client;
}

function startClientForDocument(context: ExtensionContext) {
  return (document: TextDocument): void => {
    // Only handle Elixir documents.
    if (!LANGUAGES.includes(document.languageId)) {
      return;
    }

    // Untitled documents are handled by a default client.
    if (document.uri.scheme === "untitled" && !defaultClient) {
      const documentSelector: DocumentSelector = LANGUAGES.map(
        (language) => ({ language, scheme: "untitled" } as DocumentFilter)
      );

      defaultClient = startClient(context, documentSelector);
    }

    const folder = rootWorkspaceFolder(document.uri);

    // Workspace documents are handled by a client for each outermost workspace.
    if (folder && !workspaceClients.has(folder.uri)) {
      const pattern = `${folder.uri.fsPath}/**/*`;
      const documentSelector: DocumentSelector = LANGUAGES.map(
        (language) => ({ language, scheme: "file", pattern } as DocumentFilter)
      );

      const client = startClient(context, documentSelector, folder);
      workspaceClients.set(folder.uri, client);
    }
  };
}

export function activate(context: ExtensionContext): void {
  testElixir();

  detectConflictingExtension("mjmcloug.vscode-elixir");
  detectConflictingExtension("sammkj.vscode-elixir-formatter");

  configureCommands(context);
  configureDebugger(context);
  configureTerminalLinks(context);

  vscode.workspace.onDidOpenTextDocument(startClientForDocument(context));
  vscode.workspace.textDocuments.forEach(startClientForDocument(context));

  vscode.workspace.onDidChangeWorkspaceFolders((event) => {
    event.removed.forEach((folder) => {
      const client = workspaceClients.get(folder.uri);

      if (client) {
        workspaceClients.delete(folder.uri);
        client.stop();
      }
    });
  });
}

export async function deactivate(): Promise<void> {
  const promises: Promise<void>[] = [];

  if (defaultClient) {
    promises.push(defaultClient.stop());
  }

  for (const client of workspaceClients.values()) {
    promises.push(client.stop());
  }

  await Promise.all(promises);
}
