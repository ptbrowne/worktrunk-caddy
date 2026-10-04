export type Route = { repo: string; branch: string; service: string; host: string; path: string; up: boolean }

declare module 'claude-code' {
  interface PluginState {
    'wt-caddy-status': { routes: Route[] }
  }
}
