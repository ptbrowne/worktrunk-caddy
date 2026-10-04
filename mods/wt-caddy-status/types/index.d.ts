export type Route = { repo: string; branch: string; service: string; host: string; path: string; up: boolean }

export type Defined = { name: string; service: string }

declare module 'claude-code' {
  interface PluginState {
    'wt-caddy-status': { routes: Route[]; defined: Defined[] }
  }
}
