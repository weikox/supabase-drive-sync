-- Tabla de facturas Naturgy (cache local de la lista que devuelve la API)
CREATE TABLE public.naturgy_invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  contract_account_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  invoice_num TEXT,
  issued_date DATE,
  period_from DATE,
  period_to DATE,
  amount NUMERIC(12,2),
  status TEXT,
  pdf_document_id TEXT,
  pdf_storage_path TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, contract_account_id, invoice_id)
);

CREATE INDEX idx_naturgy_invoices_user ON public.naturgy_invoices(user_id, issued_date DESC);

ALTER TABLE public.naturgy_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own invoices" ON public.naturgy_invoices
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own invoices" ON public.naturgy_invoices
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own invoices" ON public.naturgy_invoices
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own invoices" ON public.naturgy_invoices
  FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_naturgy_invoices_updated
BEFORE UPDATE ON public.naturgy_invoices
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Bucket privado para los PDFs
INSERT INTO storage.buckets (id, name, public) VALUES ('invoices', 'invoices', false);

-- RLS de storage: cada usuario accede solo a su carpeta {user_id}/...
CREATE POLICY "Users read own invoice PDFs" ON storage.objects
  FOR SELECT USING (bucket_id = 'invoices' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own invoice PDFs" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'invoices' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own invoice PDFs" ON storage.objects
  FOR DELETE USING (bucket_id = 'invoices' AND auth.uid()::text = (storage.foldername(name))[1]);