export function getMaintenanceJob(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  if (day !== 1 || hour !== 3) return null;
  if (minute === 0) return "prune";
  if (minute === 5) return "reindex_logs";
  if (minute === 7) return "reindex_incidents";
  return null;
}

export async function runMaintenanceJob(job, pool) {
  const { rows } = await pool.query(
    "SELECT data_verified FROM mikage.migration_state WHERE singleton = true"
  );
  if (rows[0]?.data_verified !== true) {
    throw new Error("移行データの照合が完了していません。");
  }

  if (job === "prune") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const logs = await client.query(
        "DELETE FROM mikage.logs WHERE created_at < ((DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo') - INTERVAL '1 month') AT TIME ZONE 'Asia/Tokyo')"
      );
      const incidents = await client.query(
        "DELETE FROM mikage.incidents WHERE created_at < ((DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo') - INTERVAL '1 month') AT TIME ZONE 'Asia/Tokyo')"
      );
      const watchBatches = await client.query(
        "DELETE FROM mikage.watch_result_batches WHERE saved_at < ((DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo') - INTERVAL '1 month') AT TIME ZONE 'Asia/Tokyo')"
      );
      const incidentBatches = await client.query(
        "DELETE FROM mikage.incident_transition_batches WHERE saved_at < ((DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo') - INTERVAL '1 month') AT TIME ZONE 'Asia/Tokyo')"
      );
      await client.query("COMMIT");
      return {
        logsDeleted: logs.rowCount,
        incidentsDeleted: incidents.rowCount,
        watchBatchesDeleted: watchBatches.rowCount,
        incidentBatchesDeleted: incidentBatches.rowCount,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  if (job === "reindex_logs") {
    await pool.query("REINDEX TABLE CONCURRENTLY mikage.logs");
    return { table: "logs" };
  }
  if (job === "reindex_incidents") {
    await pool.query("REINDEX TABLE CONCURRENTLY mikage.incidents");
    return { table: "incidents" };
  }
  throw new Error("未対応のmaintenance jobです。");
}
