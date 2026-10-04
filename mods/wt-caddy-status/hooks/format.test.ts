import { test, expect } from 'claude-code/testing'
import { notRegistered, parseDefined, routesFor, statusText, type Route } from './format'

const wt = '/w/repo/.claude/worktrees/feat'
const routes: Route[] = [
  { repo: 'repo', branch: 'feat', service: 'storybook', host: 'storybook.feat.repo.localhost', path: wt, up: true },
  { repo: 'repo', branch: 'feat', service: 'main', host: 'feat.repo.localhost', path: wt, up: true },
  { repo: 'repo', branch: 'feat', service: 'server', host: 'server.feat.repo.localhost', path: wt, up: false },
  { repo: 'repo', branch: 'feat', service: 'main', host: 'other.repo.localhost', path: '/w/repo/.claude/worktrees/other', up: true },
]

test('keeps only the session worktree, main service first', () => {
  expect(routesFor(routes, wt).map((r) => r.service)).toEqual(['main', 'server', 'storybook'])
})

test('a subdirectory of the worktree matches, a sibling prefix does not', () => {
  expect(routesFor(routes, `${wt}/apps/client`).length).toBe(3)
  expect(routesFor(routes, `${wt}-2`).length).toBe(0)
})

test('status shows liveness per service and the main URL', () => {
  expect(statusText(routes, wt)).toBe('● dev  ○ server  ● storybook · feat.repo.localhost:8080')
})

test('no routes, no status', () => {
  expect(statusText(routes, '/elsewhere')).toBe(undefined)
})

const hooks = [
  { name: 'server', expanded: "wt-caddy add repo feat 1 --path /w --cmd 'pnpm dev' --start" },
  { name: 'storybook', expanded: "wt-caddy add repo feat 2 --service storybook --rewrite-host --path /w --start" },
  { name: 'open', expanded: 'sleep 2; open http://feat.repo.localhost:8080' },
]

test('defined services come from the wt-caddy add hooks, main when no --service', () => {
  expect(parseDefined(hooks)).toEqual([
    { name: 'server', service: 'main' },
    { name: 'storybook', service: 'storybook' },
  ])
})

test('a defined service without a route is not registered', () => {
  const only = routes.filter((r) => r.service === 'main' && r.path === wt)
  expect(notRegistered(parseDefined(hooks), only)).toEqual([{ name: 'storybook', service: 'storybook' }])
})
