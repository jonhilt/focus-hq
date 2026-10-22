/**
 * What every session is told about the words it leaves where others read them (the developers', QA's and the leads'
 * prompts). The ship's roles (captain, crew, stations) are how Focus talks to its agents, but agents kept writing
 * them into pull requests, commits and code, where they read as jargon to anyone outside the ship.
 */
export const PUBLIC_WORDS_RULE =
  'In anything others read outside Focus (pull request titles and descriptions, review reports, commit messages, code, comments and docs), ' +
  "don't use the ship's terms for people: say \"the user\", \"the reviewer\" or \"the maintainer\", never \"the captain\" or \"the crew\".";
