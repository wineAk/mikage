import type { LogResult } from "@/types/watch";

export type IncidentNotificationIncident = {
  instatus_id: string | null;
  googlechat_name: string | null;
  created_at: string;
};

export type InstatusNotificationOptions = {
  started: string;
  page_id: string;
  components: string[];
  serviceName?: string;
};

export type InstatusNotificationClients = {
  createIncident: (
    options: InstatusNotificationOptions
  ) => Promise<{ incident?: { id?: string }; id?: string } | null | undefined>;
  updateIncident: (
    incidentId: string,
    options: InstatusNotificationOptions
  ) => Promise<{ incident?: { id?: string }; id?: string } | null | undefined>;
  resolveIncident: (incidentId: string, options: InstatusNotificationOptions) => Promise<unknown>;
};

export type GoogleChatNotificationClients = {
  createThread: (
    errors: LogResult[],
    instatusUrl: string | null
  ) => Promise<{ thread?: { name?: string | null } } | null | undefined>;
  updateThread: (errors: LogResult[], name: string) => Promise<unknown>;
  resolveThread: (errors: LogResult[], name: string) => Promise<unknown>;
};

export type ActiveIncidentNotificationDelivery =
  | {
      instatusId: string | null;
      googleChatName: string | null;
      instatusUrl: null;
      delivered: false;
    }
  | {
      instatusId: string | null;
      googleChatName: string | null;
      instatusUrl: string | null;
      delivered: true;
      mode?: "preview_mock" | "production";
    };

export type ResolvedIncidentNotificationDelivery =
  | { delivered: false }
  | { delivered: true; mode?: "preview_mock" | "production" };

export declare function deliverActiveIncidentNotifications(args: {
  environment: NodeJS.ProcessEnv;
  label: string;
  errors: LogResult[];
  incident: IncidentNotificationIncident;
  pageId: string;
  component: string;
  serviceName: string;
  now: Date;
  instatusClients: InstatusNotificationClients;
  googleChatClients: GoogleChatNotificationClients;
}): Promise<ActiveIncidentNotificationDelivery>;

export declare function deliverResolvedIncidentNotifications(args: {
  environment: NodeJS.ProcessEnv;
  incident: IncidentNotificationIncident;
  pageId: string;
  component: string;
  now: Date;
  instatusClients: InstatusNotificationClients;
  googleChatClients: GoogleChatNotificationClients;
}): Promise<ResolvedIncidentNotificationDelivery>;
