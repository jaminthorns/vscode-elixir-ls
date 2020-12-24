import * as os from "os";

import { execSync } from "child_process";
import { extensions, env, window } from "vscode";

import { EXTENSION_ID } from "../constants";
import Command from "./Command";

function copyDebugInfo(): void {
  const extension = extensions.getExtension(EXTENSION_ID);

  if (extension === undefined) {
    return;
  }

  const message = `
* Elixir & Erlang versions (elixir --version): ${execSync("elixir --version")}
* VSCode ElixirLS version: ${extension.packageJSON.version}
* Operating System Version: ${os.platform()} ${os.release()}
`;

  env.clipboard.writeText(message);
  window.showInformationMessage("Copied ElixirLS debug info to clipboard.");
}

export default {
  name: "extension.copyDebugInfo",
  command: copyDebugInfo,
} as Command;
