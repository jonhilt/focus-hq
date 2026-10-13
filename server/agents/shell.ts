/**
 * A Bash command split into its simple commands (at `&&`, `||`, `;`, `|` and newlines), each a list of words with
 * their quoting taken off, for spotting what a session ran (`gitCommit`, `scratchScript`). Quote-aware, so a quoted
 * `;` or `&&` stays in its word; a heredoc's body is skipped, except when it's a command substitution's in a quoted
 * word (`-m "$(cat <<'EOF' … EOF)"`), which becomes that word's text. Not a full shell parser: enough to read the
 * commands sessions write.
 */
export function shellCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  // heredocs opened on this line, whose bodies follow it
  const pending: string[] = [];
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  // past the line that's only `delimiter`, from the start of a line
  const pastBody = (from: number, delimiter: string): number => {
    let at = from;
    while (at < command.length) {
      const next = command.indexOf('\n', at);
      const line = command.slice(at, next < 0 ? command.length : next);
      if (line.trim() === delimiter) return next < 0 ? command.length : next + 1;
      if (next < 0) break;
      at = next + 1;
    }
    return command.length;
  };
  let i = 0;
  while (i < command.length) {
    const c = command[i];
    const sub = c === '"' ? /^"\$\(\s*cat\s+<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*\n?\s*\)"/.exec(command.slice(i)) : null;
    const heredoc = c === '<' ? /^<<-?\s*['"]?(\w+)['"]?/.exec(command.slice(i)) : null;
    if (sub) {
      // "$(cat <<'EOF' … EOF)": the heredoc's body is the word's text
      word += sub[2];
      inWord = true;
      i += sub[0].length;
    } else if (heredoc) {
      endWord();
      pending.push(heredoc[1]);
      i += heredoc[0].length;
    } else if (c === '\\' && i + 1 < command.length) {
      word += command[i + 1];
      inWord = true;
      i += 2;
    } else if (c === "'") {
      const close = command.indexOf("'", i + 1);
      word += command.slice(i + 1, close < 0 ? command.length : close);
      inWord = true;
      i = close < 0 ? command.length : close + 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < command.length && command[j] !== '"') {
        if (command[j] === '\\' && j + 1 < command.length) j++;
        word += command[j];
        j++;
      }
      inWord = true;
      i = j + 1;
    } else if (c === '\n') {
      endCommand();
      i++;
      // the bodies of the heredocs opened on the line just ended are input, not commands
      for (const delimiter of pending.splice(0)) i = pastBody(i, delimiter);
    } else if ((c === '&' && command[i + 1] === '&') || (c === '|' && command[i + 1] === '|')) {
      endCommand();
      i += 2;
    } else if (c === '|' || c === ';') {
      endCommand();
      i++;
    } else if (/\s/.test(c)) {
      endWord();
      i++;
    } else {
      word += c;
      inWord = true;
      i++;
    }
  }
  endCommand();
  return commands;
}
