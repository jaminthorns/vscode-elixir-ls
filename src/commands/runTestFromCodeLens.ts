import { window } from "vscode";

import Command from "./Command";

type RunArgs = {
  filePath: string;
  describe: string | null;
  testName?: string;
  module?: string;
};

function runTestFromCodeLens(args: RunArgs): void {
  const elixirLsTerminal =
    window.terminals.find((terminal) => terminal.name == "ElixirLS") ||
    window.createTerminal("ElixirLS");

  elixirLsTerminal.show();
  elixirLsTerminal.sendText("clear");
  elixirLsTerminal.sendText(buildTestCommand(args));
}

function buildTestCommand(args: RunArgs): string {
  const testFilter = buildTestInclude(args);
  return `mix test --exclude test --include "${testFilter}" ${args.filePath}`;
}

function buildTestInclude(args: RunArgs) {
  if (args.module) {
    return `module:${args.module}`;
  }

  if (!args.testName) {
    return `describe:${args.describe}`;
  }

  if (args.describe) {
    return `test:test ${args.describe} ${args.testName}`;
  }

  return `test:test ${args.testName}`;
}

export default {
  name: "elixir.lens.test.run",
  command: runTestFromCodeLens,
} as Command;
