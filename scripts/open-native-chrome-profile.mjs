#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { get } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Command, InvalidArgumentError } from 'commander';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

const options = new Command()
  .name('open-native-chrome-profile')
  .description('Open native Google Chrome with a Heddle-specific profile and CDP endpoint.')
  .option('--profile <id>', 'profile id under .heddle/native-chrome-profiles/', parseProfileId, 'browser-automation')
  .option('--port <port>', 'remote debugging port', parsePort, 9222)
  .option('--url <url>', 'initial URL', 'about:blank')
  .option('--state-root <path>', 'Heddle state root', (value) => resolve(value), resolve(repoRoot, '.heddle'))
  .option('--chrome-path <path>', 'explicit Chrome binary path')
  .option('--print-only', 'print the Chrome command without launching')
  .option('--allow-port-in-use', 'continue when the CDP port is already occupied')
  .showHelpAfterError()
  .parse()
  .opts();

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
const launchCommand = createLaunchCommand(chromePath, chromeArgs);

console.log(`Chrome: ${chromePath}`);
console.log(`Profile: ${userDataDir}`);
console.log(`CDP endpoint: http://127.0.0.1:${options.port}`);
console.log(`Start URL: ${options.url}`);

if (options.printOnly) {
  console.log('\nCommand:');
  console.log(launchCommand.display);
  process.exit(0);
}

mkdirSync(userDataDir, { recursive: true });

const portAvailable = await isPortAvailable(options.port);
if (!portAvailable && !options.allowPortInUse) {
  console.error(`Port ${options.port} is already in use. Pass --port <free-port> or --allow-port-in-use if this is the Chrome instance you meant to reuse.`);
  process.exit(1);
}

const child = spawn(launchCommand.command, launchCommand.args, {
  detached: true,
  stdio: 'ignore',
});
child.unref();

const cdpReady = await waitForCdpEndpoint(options.port, 10_000);
if (!cdpReady) {
  console.error([
    '',
    `Chrome was launched, but http://127.0.0.1:${options.port}/json/version did not become reachable.`,
    'Close any Chrome window that is already using this profile, then run the command again.',
  ].join('\n'));
  process.exit(1);
}

console.log('\nLaunched native Chrome with CDP enabled. Use this profile window to log in, then keep it open while testing CDP attach.');

function parseProfileId(profileId) {
  if (!PROFILE_ID_PATTERN.test(profileId)) {
    throw new InvalidArgumentError('must start with a letter or number and only use letters, numbers, dots, underscores, or hyphens');
  }

  return profileId;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new InvalidArgumentError('must be an integer between 1024 and 65535');
  }

  return port;
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

function createLaunchCommand(chromePath, chromeArgs) {
  const macAppBundle = process.platform === 'darwin' ? macAppBundlePath(chromePath) : undefined;
  if (macAppBundle) {
    const args = ['-n', '-a', macAppBundle, '--args', ...chromeArgs];
    return {
      command: '/usr/bin/open',
      args,
      display: [quote('/usr/bin/open'), ...args.map(quote)].join(' '),
    };
  }

  return {
    command: chromePath,
    args: chromeArgs,
    display: [quote(chromePath), ...chromeArgs.map(quote)].join(' '),
  };
}

function macAppBundlePath(chromePath) {
  const marker = '.app/Contents/MacOS/';
  const markerIndex = chromePath.indexOf(marker);
  if (markerIndex === -1) {
    return undefined;
  }

  return chromePath.slice(0, markerIndex + '.app'.length);
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

async function waitForCdpEndpoint(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isCdpEndpointReachable(port)) {
      return true;
    }
    await sleep(250);
  }

  return false;
}

function isCdpEndpointReachable(port) {
  return new Promise((resolveReachable) => {
    const request = get(`http://127.0.0.1:${port}/json/version`, (response) => {
      response.resume();
      resolveReachable(response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(1000, () => {
      request.destroy();
      resolveReachable(false);
    });
    request.once('error', () => resolveReachable(false));
  });
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function quote(value) {
  return value.includes(' ') ? `"${value.replaceAll('"', '\\"')}"` : value;
}
