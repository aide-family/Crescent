# SSH connections

Crescent can read `~/.ssh/config`. It also supports custom SSH connections, login actions, SSH options, and password environment variables.

Switch among these in one workbench:

- Local terminal
- Test environments
- Production hosts
- Other remote machines

The Agent treats the selected connection as the worksite. After you change hosts, later commands run in the new session.

To inspect another host in parallel, use `open_subterminal` from [Agent tools](/en/guide/tools) and dock a dedicated local or SSH terminal.
