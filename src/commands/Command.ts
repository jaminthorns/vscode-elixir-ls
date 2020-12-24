export default interface Command {
  name: string;
  command: (args: unknown) => void;
}
