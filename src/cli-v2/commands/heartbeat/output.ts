export function printHeartbeatHelp() {
  process.stdout.write([
    'Usage: heddle heartbeat <command>',
    '',
    'Manage and run heartbeat tasks',
    '',
    'Commands:',
    '  task add                 add a heartbeat task',
    '  task list                list heartbeat tasks',
    '  task show <id>           show a heartbeat task',
    '  task enable <id>         enable a heartbeat task',
    '  task disable <id>        disable a heartbeat task',
    '  start                    create/update a task and use the server-backed scheduler',
    '  run                      ask the server to run due tasks or one task now',
    '  runs list                list heartbeat run records',
    '  runs show <id>           show a heartbeat run record',
    '',
    'Duration examples:',
    '  30s, 15m, 1h, 2d',
    '',
  ].join('\n'));
}
