/**
 * The message of a GitHub Actions workflow command (`::error::…`), escaped the
 * way the runner documents, so text from messages.yaml can never end the line
 * and start a command of its own (#55).
 */
export function commandData(text: string): string {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
