CREATE TABLE public.trend_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  submitted_by text,
  raw_email text,
  title text,
  tags text[],
  category text,
  industry text,
  section text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  score integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.trend_submissions TO service_role;
ALTER TABLE public.trend_submissions ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.trend_submissions IS 'Existing trend submission model. Browser access remains locked until an authenticated access policy is configured.';