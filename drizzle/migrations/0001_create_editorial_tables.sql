CREATE TABLE public.editorial_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), month int NOT NULL, year int NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (year, month));
CREATE TABLE public.editorial_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL REFERENCES public.editorial_plans(id) ON DELETE CASCADE, post_date date NOT NULL, canali text[] NOT NULL DEFAULT '{}', channel_copies jsonb NOT NULL DEFAULT '{}', copy_visual text, disclaimer text, formato text, obiettivo_media text, budget_media numeric, programmato boolean NOT NULL DEFAULT false, rubrica text, topic text, visual_type text, visual_url text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.editorial_post_media (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL REFERENCES public.editorial_posts(id) ON DELETE CASCADE, url text NOT NULL, type text, position int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.editorial_post_approvals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL REFERENCES public.editorial_posts(id) ON DELETE CASCADE, component text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.editorial_post_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL REFERENCES public.editorial_posts(id) ON DELETE CASCADE, component text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.editorial_published_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canale text NOT NULL, url text NOT NULL, caption text, published_date date NOT NULL, matched_post_id uuid REFERENCES public.editorial_posts(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.editorial_client_channels (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canale text NOT NULL, handle text NOT NULL, url text NOT NULL, display_name text, bio text, avatar_url text, followers_count text, following_count text, posts_count text, scraped_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.trend_submissions ADD COLUMN IF NOT EXISTS posted_at timestamptz;

DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['editorial_plans','editorial_posts','editorial_post_media','editorial_post_approvals','editorial_post_comments','editorial_published_posts','editorial_client_channels'] LOOP
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY "Public full access" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
END LOOP; END $$;

CREATE POLICY "Public read piano-editoriale" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'piano-editoriale');
CREATE POLICY "Public upload piano-editoriale" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'piano-editoriale');