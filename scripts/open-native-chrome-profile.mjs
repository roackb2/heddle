#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

const options = parseArgsOrExit(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

if (!PROFILE_ID_PATTERN.test(options.profile)) {
  console.error('Profile id must start with a letter or number and only use letters, numbers, dots, underscores, or hyphens.');
  process.exit(1);
}

if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
  console.error('Remote debugging port must be an integer between 1024 and 65535.');
  process.exit(1);
}

const chromePath = options.chromePath ?? findChromePath();
if (!chromePath) {
  console.error('Could not find Google Chrome. Pass --chrome-path /absolute/path/to/chrome.');
  process.exit(1);
}

const userDataDir = resolve(options.stateRoot, 'native-chrome-profiles', options.profile);
const chromeArgs = [
  `--remote-debugging-port=${options.port}`,
  `--user-data-dir=${userDataDir}`,
  '--new-window',
  '--no-first-run',
  '--no-default-browser-check',
  options.url,
];

console.log(`Chrome: ${chromePath}`);
console.log(`Profile: ${userDataDir}`);
console.log(`CDP endpoint: http://127.0.0.1:${options.port}`);
console.log(`Start URL: ${options.url}`);

if (options.printOnly) {
  console.log('\nCommand:');
  console.log([quote(chromePath), ...chromeArgs.map(quote)].join(' '));
  process.exit(0);
}

mkdirSync(userDataDir, { recursive: true });

const portAvailable = await isPortAvailable(options.port);
if (!portAvailable && !options.allowPortInUse) {
  console.error(`Port ${options.port} is already in use. Pass --port <free-port> or --allow-port-in-use if this is the Chrome instance you meant to reuse.`);
  process.exit(1);
}

const child = spawn(chromePath, chromeArgs, {
  detached: true,
  stdio: 'ignore',
});
child.unref();

console.log('\nLaunched native Chrome. Use this profile window to log in, then keep it open while testing CDP attach.');

function parseArgsOrExit(args) {
  try {
    return parseArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('Run with --help for usage.');
    process.exit(1);
  }
}

function parseArgs(args) {
  const parsed = {
    profile: 'browser-automation',
    stateRoot: resolve(repoRoot, '.heddle'),
    port: 9222,
    url: 'about:blank',
    chromePath: undefined,
    printOnly: false,
    allowPortInUse: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const readValue = () => {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--profile') {
      parsed.profile = readValue();
    } else if (arg === '--state-root') {
      parsed.stateRoot = resolve(readValue());
    } else if (arg === '--port') {
      parsed.port = Number(readValue());
    } else if (arg === '--url') {
      parsed.url = readValue();
    } else if (arg === '--chrome-path') {
      parsed.chromePath = readValue();
    } else if (arg === '--print-only') {
      parsed.printOnly = true;
    } else if (arg === '--allow-port-in-use') {
      parsed.allowPortInUse = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function findChromePath() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function isPortAvailable(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once('error', () => resolvePort(false));
    server.once('listening', () => {
      server.close(() => resolvePort(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function quote(value) {
  return value.includes(' ') ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function printUsage() {
  console.log(`Open native Google Chrome with a Heddle-specific profile and CDP endpoint.

Usage:
  yarn spike:native-chrome-profile [options]

Options:
  --profile <id>          Profile id under .heddle/native-chrome-profiles/ (default: browser-automation)
  --port <port>           Remote debugging port (default: 9222)
  --url <url>             Initial URL (default: about:blank)
  --state-root <path>     Heddle state root (default: .heddle)
  --chrome-path <path>    Explicit Chrome binary path
  --print-only            Print the Chrome command without launching
  --allow-port-in-use     Continue when the CDP port is already occupied
  --help                  Show this help
`);
}
