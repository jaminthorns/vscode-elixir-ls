import * as assert from "assert";
import * as vscode from "vscode";

import { defaultClient, workspaceClients } from "../../extension";
import { EXTENSION_ID } from "../../constants";

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);

    assert(extension);

    await extension.activate();
  });

  test("starts default and workspace clients", async () => {
    const { uri: folderUri } = vscode.workspace.workspaceFolders![0];
    const sampleFileUri = vscode.Uri.parse("untitled:sample.ex");
    const workspaceFileUri = vscode.Uri.joinPath(folderUri, "mix.exs");

    await vscode.workspace.openTextDocument(sampleFileUri);
    await vscode.workspace.openTextDocument(workspaceFileUri);

    assert(defaultClient);
    assert(workspaceClients.has(folderUri));
  });
});
