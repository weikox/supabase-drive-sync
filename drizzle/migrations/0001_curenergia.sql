CREATE TABLE public.curenergia_sessions (
  user_id uuid PRIMARY KEY,
  auth_token text NOT NULL,
  cookie text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.curenergia_sessions TO authenticated;
GRANT ALL ON public.curenergia_sessions TO service_role;
ALTER TABLE public.curenergia_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own curenergia session" ON public.curenergia_sessions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.curenergia_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  supply text NOT NULL,
  contract_id text,
  invoice_id text NOT NULL,
  invoice_num text,
  issued_date date,
  period_from text,
  period_to text,
  amount numeric,
  consumption text,
  status text,
  pdf_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, invoice_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.curenergia_invoices TO authenticated;
GRANT ALL ON public.curenergia_invoices TO service_role;
ALTER TABLE public.curenergia_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own curenergia invoices" ON public.curenergia_invoices FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_curenergia_invoices_updated BEFORE UPDATE ON public.curenergia_invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();