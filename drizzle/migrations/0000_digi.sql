CREATE TABLE IF NOT EXISTS public.digi_sessions (
  user_id uuid PRIMARY KEY,
  device_cookie text,
  pending_uuid text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.digi_sessions TO authenticated;
GRANT ALL ON public.digi_sessions TO service_role;
ALTER TABLE public.digi_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own digi session" ON public.digi_sessions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.digi_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  invoice_id text NOT NULL,
  contract_id text,
  invoice_num text,
  issued_date date,
  amount numeric,
  status text,
  pdf_url text,
  pdf_storage_path text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, invoice_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.digi_invoices TO authenticated;
GRANT ALL ON public.digi_invoices TO service_role;
ALTER TABLE public.digi_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own digi invoices" ON public.digi_invoices FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_digi_invoices_updated BEFORE UPDATE ON public.digi_invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();