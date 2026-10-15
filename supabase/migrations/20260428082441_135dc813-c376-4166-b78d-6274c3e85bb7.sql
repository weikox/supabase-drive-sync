CREATE TABLE public.invoice_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  task_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  captured_lists JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE public.invoice_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own runs" ON public.invoice_runs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own runs" ON public.invoice_runs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own runs" ON public.invoice_runs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own runs" ON public.invoice_runs
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_invoice_runs_user_created ON public.invoice_runs(user_id, created_at DESC);