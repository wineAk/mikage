ALTER TABLE mikage.incident_transition_batches
  DROP CONSTRAINT incident_transition_batches_transition_check;

ALTER TABLE mikage.incident_transition_batches
  ADD CONSTRAINT incident_transition_batches_transition_check
  CHECK (transition IN ('open', 'notification_pending', 'update', 'close'));
