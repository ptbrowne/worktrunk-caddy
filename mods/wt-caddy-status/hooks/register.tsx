import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { notRegistered, parseDefined, routesFor, statusText, type Defined, type Route } from './format'

const PANE = 'servers'
const routes = atom({ plugin: 'wt-caddy-status', key: 'routes' } as const, [])
const defined = atom({ plugin: 'wt-caddy-status', key: 'defined' } as const, [])


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

// The services this worktree's post-start hooks define, registered or not.
const loadDefined = async ($: EngineInterface) => {
  try {
    const ran = await $.process.run([bin, 'hooks'], { timeoutMs: 10000 })
    const hooks = JSON.parse(ran.stdout) as { name: string; expanded: string }[]
    await update($, defined, () => parseDefined(hooks))
  } catch {
    await update($, defined, () => [])
  }
}

// Shows the service's log the way config.jsonc says (a kitty split, a tmux pane, ...); without that, toasts the path.
const showLog = async ($: EngineInterface, r: Route) => {
  const ran = await $.process.run([bin, 'logs', r.repo, r.branch, '--service', r.service, '--open'], { timeoutMs: 10000 })
  const text = (ran.exitCode === 0 ? ran.stdout : ran.stderr).trim()
  if (text) $.ui.toast(text)
}

// Runs the one hook that registers and starts a defined service.
const startDefined = async ($: EngineInterface, d: Defined) => {
  await $.process.run([bin, 'hook', d.name], { timeoutMs: 20000 })
  await refresh($)
  await loadDefined($)
}

// verb is a wt-caddy subcommand; the pane redraws once the refresh sees the new state.
const run = async ($: EngineInterface, verb: string, r: Route) => {
  await $.process.run([bin, verb, r.repo, r.branch, '--service', r.service], { timeoutMs: 20000 })
  await refresh($)
}

// Asking for the keyboard is only a request: the surface refuses it while the composer still holds
// the typed "/servers", so this is called again once the command has run.
const openFocused = async ($: EngineInterface) => {
  const opened = await $.ui.open({ id: PANE, title: 'Dev servers', focus: true, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast(`/servers: pane not shown (${opened.reason})`)
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
    await loadDefined($)
    await openFocused($)
    $.clock.after(200, () => openFocused($))
    return { text: 'Dev servers pane opened. Up/Down move, Enter presses, Esc closes. If keys do not reach it, press ctrl+x then Tab.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, routes)
    const idle = notRegistered(await read($, defined), list)

    if (list.length === 0 && idle.length === 0) return <Text dimColor>No dev servers defined for this worktree.</Text>

    return (
      <Box flexDirection="column">
        {list.map(r => (
          <Box key={`svc:${r.service}`} flexDirection="column">
          <Box key={`row:${r.service}`} flexDirection="row">
            <Text>
              {r.up ? '●' : '○'} {(r.service === 'main' ? 'dev' : r.service).padEnd(12)}
            </Text>
            <Button
              key={`toggle:${r.service}`}
              label={r.up ? 'stop' : 'start'}
              autoFocus={r === list[0] ? true : undefined}
              onPress={() => run($, r.up ? 'stop' : 'start', r)}
            />
          </Box>
          <Box key={`logrow:${r.service}`} flexDirection="row">
            <Text dimColor>{'  '.padEnd(16)}</Text>
            <Button key={`logs:${r.service}`} label="logs" dimColor onPress={() => showLog($, r)} />
          </Box>
          </Box>
        ))}
        {idle.map(d => (
          <Box key={`idle:${d.service}`} flexDirection="row">
            <Text dimColor>○ {(d.service === 'main' ? 'dev' : d.service).padEnd(12)}</Text>
            <Button key={`startdef:${d.service}`} label="start" onPress={() => startDefined($, d)} />
            <Text dimColor> not started</Text>
          </Box>
        ))}
        <Text dimColor>Up/Down move, Enter presses, Esc closes</Text>
      </Box>
    )
  })
}
