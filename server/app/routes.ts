import { type RouteConfig, index, route, prefix } from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),

  ...prefix("api/v1", [
    // http://localhost:5173/api/v1
    index("routes/api/index.tsx"),
    // http://localhost:5173/api/v1/errors
    route("errors/:offset", "routes/api/errors.tsx"),
    // http://localhost:5173/api/v1/targets
    route("targets", "routes/api/targets.tsx"),
    // http://localhost:5173/api/v1/watch
    route("watch", "routes/api/watch.tsx"),
    // http://localhost:5173/api/v1/keys/saaske04/hour/1
    // http://localhost:5173/api/v1/keys/works07,works09/hour/3
    route("keys/:keys/hour/:hour", "routes/api/keys.tsx"),
    // http://localhost:5173/api/v1/notfound
    route("*", "routes/api/404.tsx"),
  ]),

] satisfies RouteConfig;
