import { type RouteConfig, index, route, prefix, layout } from "@react-router/dev/routes";

export default [
  layout("routes/layout.tsx", [
    index("routes/index.tsx"),
    route("incidents", "routes/incidents.tsx"),
    route("errors", "routes/errors.tsx"),
    route("login", "routes/login/layout.tsx", [
      index("routes/login/index.tsx"),
      route(":key", "routes/login/key.tsx"),
    ]),
  ]),

  ...prefix("api/v1", [
    index("routes/api/index.tsx"),
    route("errors/:offset", "routes/api/errors.tsx"),
    route("incidents/:offset", "routes/api/incidents.tsx"),
    route("targets", "routes/api/targets.tsx"),
    route("watch", "routes/api/watch.tsx"),
    route("keys/:keys/minute/:minute", "routes/api/keys.tsx"),
    route("*", "routes/api/404.tsx"),
  ]),

] satisfies RouteConfig;
