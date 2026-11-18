export const gatewayRouteContracts = [
  { source: "watch-targets", method: "GET", path: "/gw/watch-targets", apiPath: "/v1/monitoring/targets" },
  { source: "watch-reservations", method: "POST", path: "/gw/watch-reservations", apiPath: "/v1/watch/reservations" },
  { source: "watch-results", method: "POST", path: "/gw/watch-results", apiPath: "/v1/watch/results" },
  { source: "watch-state", method: "GET", path: "/gw/watch-state", apiPath: "/v1/watch/state" },
  { source: "watch-incidents", method: "POST", path: "/gw/watch-incidents", apiPath: "/v1/watch/incidents" },
  { source: "view-targets", method: "GET", path: "/gw/view-targets", apiPath: "/v1/view/targets" },
  { source: "view-target-proxy", method: "GET", path: "/gw/view-target-proxy", apiPath: "/v1/view/target-proxy" },
  { source: "view-logs", method: "GET", path: "/gw/view-logs", apiPath: "/v1/view/logs" },
  { source: "view-errors", method: "GET", path: "/gw/view-errors", apiPath: "/v1/view/errors" },
  { source: "view-incidents", method: "GET", path: "/gw/view-incidents", apiPath: "/v1/view/incidents" },
  { source: "view-revision", method: "GET", path: "/gw/view-revision", apiPath: "/v1/view/revision" },
];
