-- Reduce duplicate reminder delivery risk when scheduled invocations overlap.
-- A short claim lease allows recovery if a worker dies while processing.
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.reminders DROP CONSTRAINT IF EXISTS reminders_status_check;
ALTER TABLE public.reminders
  ADD CONSTRAINT reminders_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'cancelled'::text]));
CREATE INDEX IF NOT EXISTS reminders_processing_claim_idx ON public.reminders(status, claimed_at)
  WHERE status = 'processing';
