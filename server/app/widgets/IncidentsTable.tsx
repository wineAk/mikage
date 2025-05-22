import { useEffect, useState } from "react";
import type { KeyLog, Key, Error, Incident } from "@/types/api";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "~/components/ui/card";
import { ScrollArea, ScrollBar } from "~/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

import CardLoading from "./CardLoading";
import { getColorListsFromKey } from "~/library/index/color";

export default function IncidentsTable() {
  const [offset, setOffset] = useState(0);

  const [incidents, setIncidents] = useState<Incident[]>([]);
  useEffect(() => {
    fetch(`/api/v1/incidents/${offset}`)
      .then((res) => res.json())
      .then((res) => setIncidents(res.data));
  }, [offset]);

  const [errors, setErrors] = useState<Error[]>([]);
  useEffect(() => {
    fetch(`/api/v1/errors/${offset}`)
      .then((res) => res.json())
      .then((res) => setErrors(res.data));
  }, [offset]);

  type IncidentError = Incident & {
    errors: Error[];
  }
  // incidentのデータをもとに、errorsのデータを取得する
  const [incidentErrors, setIncidentErrors] = useState<IncidentError[]>([]);
  useEffect(() => {
    const incidentErrors = incidents.map((incident) => {
      const { keyword, created_at, updated_at } = incident;
      const created_date = new Date(created_at);
      created_date.setSeconds(0, 0);
      const updated_date = new Date(updated_at);
      // keywordで始まるtarget_keyだけ抽出
      const filtered = errors.filter((error) => {
        const { target_key, created_at } = error;
        if (!target_key.startsWith(keyword)) return false;
        const error_date = new Date(created_at);
        return error_date >= created_date && error_date <= updated_date;
      });

      const incidentError = {
        ...incident,
        errors: filtered,
      }

      return incidentError;
    });
    setIncidentErrors(incidentErrors);
  }, [incidents, errors]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Incidents</CardTitle>
      </CardHeader>
    </Card>
  );
}