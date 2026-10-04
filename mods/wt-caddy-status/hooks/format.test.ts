import { test, expect } from 'claude-code/testing'
import { routesFor, statusText, type Route } from './format'

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
