import { type RouteConfig, index, route, prefix } from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),

  ...prefix("api/v1", [
    index("routes/api/index.tsx"),
    route("errors/:offset", "routes/api/errors.tsx"),
    route("targets", "routes/api/targets.tsx"),
    route("watch", "routes/api/watch.tsx"),
    route("keys/:keys/minute/:minute", "routes/api/keys.tsx"),
    route("*", "routes/api/404.tsx"),
  ]),

] satisfies RouteConfig;
