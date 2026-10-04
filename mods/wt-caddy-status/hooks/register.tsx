import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { CADDY_PORT, routesFor, statusText, type Route } from './format'

const PANE = 'servers'
const routes = atom({ plugin: 'wt-caddy-status', key: 'routes' } as const, [])

let bin = ''
let lastStatus: string | undefined
let lastRoutes = ''

// wt-caddy checks which ports listen, so one spawn per refresh gives routes and liveness.
const refresh = async ($: EngineInterface) => {
  try {
    const cwd = await $.session.cwd()
    const ran = await $.process.run([bin, 'ls', '--json'], { timeoutMs: 5000 })
    const all = JSON.parse(ran.stdout) as Route[]
    const mine = routesFor(all, cwd)

    const snapshot = JSON.stringify(mine)
    if (snapshot !== lastRoutes) {
      lastRoutes = snapshot
      await update($, routes, () => mine)
    }

    const text = statusText(all, cwd)
    const shown = text === undefined ? undefined : `${text} · /servers`
    if (shown !== lastStatus) {
      lastStatus = shown
      $.ui.status(shown)
    }
  } catch {
    // wt-caddy missing or registry unreadable: keep what is shown
  }
}

// verb is a wt-caddy subcommand; the pane redraws once the refresh sees the new state.
const run = async ($: EngineInterface, verb: string, r: Route) => {
  await $.process.run([bin, verb, r.repo, r.branch, '--service', r.service], { timeoutMs: 20000 })
  await refresh($)
}

const openUrl = async ($: EngineInterface, r: Route) => {
  await $.process.run(['open', `http://${r.host}:${CADDY_PORT}`])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    bin = `${await $.env.get('HOME')}/bin/wt-caddy`
    await $.command.register({ name: 'servers', description: 'Start, stop and open this worktree\'s dev servers' })
    $.clock.every(3000, () => refresh($))
    await refresh($)
    return next(e)
  })

  on('command.run', { command: 'servers' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Dev servers', focus: true, closeOnEscape: true })
    return { text: 'Dev servers: Tab or arrows to move, Enter to press, Esc to close.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, routes)

    if (list.length === 0) return <Text dimColor>No dev servers registered for this worktree.</Text>

    return (
      <Box flexDirection="column">
        {list.map(r => (
          <Box key={`row:${r.service}`} flexDirection="row">
            <Text>
              {r.up ? '●' : '○'} {(r.service === 'main' ? 'dev' : r.service).padEnd(12)}
            </Text>
            <Button key={`start:${r.service}`} label="start" autoFocus={r === list[0] ? true : undefined} onPress={() => run($, 'start', r)} />
            <Button key={`stop:${r.service}`} label="stop" onPress={() => run($, 'stop', r)} />
            <Button key={`restart:${r.service}`} label="restart" onPress={() => run($, 'restart', r)} />
            <Button
              key={`open:${r.service}`}
              label="open"
              onPress={() => openUrl($, r)}
            />
          </Box>
        ))}
        <Text dimColor>Tab/arrows move, Enter presses, Esc closes</Text>
      </Box>
    )
  })
}
