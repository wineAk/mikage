import type { ErrorLog } from "@/types/api";

import { columns } from "./columns";
import { DataTable } from "./dataTable";

import { CardContent } from "~/components/ui/card";

type ErrorTableProps = {
  data: ErrorLog[];
};

export default function ErrorTable({ data }: ErrorTableProps) {
  return (
    <CardContent>
      <DataTable columns={columns} data={data} />
    </CardContent>
  );
}
